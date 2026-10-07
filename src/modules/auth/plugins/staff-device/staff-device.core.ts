import type { AuthContext } from 'better-auth';
import type { StaffRole } from '../../../../common/types/tx.type.js';
import {
  hashPin,
  newOpaqueToken,
  sha256,
  verifyPin as verifyPinHash,
} from './pin-hasher.js';
import type { DeviceRow, MemberRow, StaffPinRow } from './schema.js';

/**
 * Device/PIN logic on Better Auth's adapter. Shared by the plugin endpoints (device-facing)
 * and AuthService (admin-facing, behind Nest permissions). Nothing here touches the app's Prisma client.
 */
export interface StaffDeviceOptions {
  pinPepper: string;
  staffSessionHours: number;
  maxPinAttempts?: number;
  lockMinutes?: number;
  approvalTtlSeconds?: number;
  onDeviceRevoked?: (e: {
    organizationId: string;
    deviceId: string;
  }) => void | Promise<void>;
}

export const APPROVER_ROLES: StaffRole[] = ['owner', 'manager'];

export async function resolveDevice(
  ctx: AuthContext,
  rawToken: string | null | undefined,
): Promise<DeviceRow | null> {
  if (!rawToken) return null;
  const device = await ctx.adapter.findOne<DeviceRow>({
    model: 'device',
    where: [{ field: 'tokenHash', value: sha256(rawToken) }],
  });
  if (!device || device.revokedAt || !device.approvedAt) return null;
  return device;
}

export async function findMember(
  ctx: AuthContext,
  organizationId: string,
  userId: string,
): Promise<MemberRow | null> {
  return ctx.adapter.findOne<MemberRow>({
    model: 'member',
    where: [
      { field: 'organizationId', value: organizationId },
      { field: 'userId', value: userId },
    ],
  });
}

/** One-time device token: returned once, stored hashed. */
export async function registerDevice(
  ctx: AuthContext,
  input: { organizationId: string; name: string; approvedBy: string },
) {
  const token = newOpaqueToken();
  const now = new Date();
  const device = await ctx.adapter.create<Omit<DeviceRow, 'id'>, DeviceRow>({
    model: 'device',
    data: {
      organizationId: input.organizationId,
      name: input.name,
      tokenHash: sha256(token),
      approvedBy: input.approvedBy,
      approvedAt: now,
      lastSeenAt: null,
      revokedAt: null,
      createdAt: now,
    },
  });
  return { device, token };
}

/** Revokes the device and deletes its sessions through the internal adapter (clears Redis copies too). */
export async function revokeDevice(
  ctx: AuthContext,
  opts: StaffDeviceOptions,
  input: { organizationId: string; deviceId: string },
) {
  const device = await ctx.adapter.findOne<DeviceRow>({
    model: 'device',
    where: [
      { field: 'id', value: input.deviceId },
      { field: 'organizationId', value: input.organizationId },
    ],
  });
  if (!device) return null;
  if (!device.revokedAt) {
    await ctx.adapter.update({
      model: 'device',
      where: [{ field: 'id', value: device.id }],
      update: { revokedAt: new Date() },
    });
  }
  const sessions = await ctx.adapter.findMany<{ token: string }>({
    model: 'session',
    where: [{ field: 'deviceId', value: device.id }],
  });
  if (sessions.length)
    await ctx.internalAdapter.deleteSessions(sessions.map((s) => s.token));
  await opts.onDeviceRevoked?.({
    organizationId: input.organizationId,
    deviceId: device.id,
  });
  return device;
}

export async function setPin(
  ctx: AuthContext,
  opts: StaffDeviceOptions,
  input: { organizationId: string; userId: string; pin: string },
) {
  const pinHash = await hashPin(input.pin, opts.pinPepper);
  const existing = await ctx.adapter.findOne<StaffPinRow>({
    model: 'staffPin',
    where: [
      { field: 'userId', value: input.userId },
      { field: 'organizationId', value: input.organizationId },
    ],
  });
  if (existing) {
    await ctx.adapter.update({
      model: 'staffPin',
      where: [{ field: 'id', value: existing.id }],
      update: {
        pinHash,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
    });
  } else {
    await ctx.adapter.create({
      model: 'staffPin',
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        pinHash,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
    });
  }
}

export type PinCheck = 'ok' | 'invalid' | 'locked';

/** Constant failure response for unknown users/PINs; atomic failure counter; lockout after N attempts. */
export async function checkPin(
  ctx: AuthContext,
  opts: StaffDeviceOptions,
  input: { organizationId: string; userId: string; pin: string },
): Promise<PinCheck> {
  const max = opts.maxPinAttempts ?? 5;
  const lockMs = (opts.lockMinutes ?? 5) * 60_000;
  const row = await ctx.adapter.findOne<StaffPinRow>({
    model: 'staffPin',
    where: [
      { field: 'userId', value: input.userId },
      { field: 'organizationId', value: input.organizationId },
    ],
  });
  if (!row) return 'invalid';
  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now())
    return 'locked';

  if (await verifyPinHash(input.pin, row.pinHash, opts.pinPepper)) {
    if (row.failedAttempts || row.lockedUntil) {
      await ctx.adapter.update({
        model: 'staffPin',
        where: [{ field: 'id', value: row.id }],
        update: { failedAttempts: 0, lockedUntil: null },
      });
    }
    return 'ok';
  }

  const bumped = await ctx.adapter.incrementOne<StaffPinRow>({
    model: 'staffPin',
    where: [{ field: 'id', value: row.id }],
    increment: { failedAttempts: 1 },
  });
  if (bumped && bumped.failedAttempts >= max) {
    await ctx.adapter.update({
      model: 'staffPin',
      where: [{ field: 'id', value: row.id }],
      update: { failedAttempts: 0, lockedUntil: new Date(Date.now() + lockMs) },
    });
    return 'locked';
  }
  return 'invalid';
}

export async function listRoster(ctx: AuthContext, organizationId: string) {
  const members = await ctx.adapter.findMany<MemberRow>({
    model: 'member',
    where: [{ field: 'organizationId', value: organizationId }],
  });
  if (!members.length) return [];
  const userIds = members.map((m) => m.userId);
  const [users, pins] = await Promise.all([
    ctx.adapter.findMany<{ id: string; name: string; image: string | null }>({
      model: 'user',
      where: [{ field: 'id', operator: 'in', value: userIds }],
    }),
    ctx.adapter.findMany<StaffPinRow>({
      model: 'staffPin',
      where: [{ field: 'organizationId', value: organizationId }],
    }),
  ]);
  const withPin = new Set(pins.map((p) => p.userId));
  const byId = new Map(users.map((u) => [u.id, u]));
  return members
    .filter((m) => withPin.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: byId.get(m.userId)?.name ?? '',
      image: byId.get(m.userId)?.image ?? null,
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createApproval(
  ctx: AuthContext,
  opts: StaffDeviceOptions,
  input: {
    organizationId: string;
    approverId: string;
    action: string;
    subjectId: string;
  },
) {
  const token = newOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (opts.approvalTtlSeconds ?? 60) * 1000,
  );
  await ctx.adapter.create({
    model: 'managerApproval',
    data: {
      ...input,
      tokenHash: sha256(token),
      expiresAt,
      consumedAt: null,
      createdAt: now,
    },
  });
  return { token, expiresAt };
}
