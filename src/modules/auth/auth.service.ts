import { AccountAuthService } from './account-auth.service.js';
import type { AuthContext } from 'better-auth';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/configuration.js';
import { FLOOR_ROLES, type StaffRole } from '../../common/types/tx.type.js';
import { AuthPrismaClient } from '../../database/auth-prisma.client.js';
import { DomainEvents } from '../../infrastructure/events/domain-events.service.js';
import { BETTER_AUTH, type AuthInstance } from './auth.config.js';
import { MemberRoleService } from './member-role.service.js';
import * as core from './plugins/staff-device/staff-device.core.js';
import type { DeviceRow, MemberRow } from './plugins/staff-device/schema.js';

export const PLACEHOLDER_EMAIL_DOMAIN = 'staff.invalid';

/**
 * The only place app code writes Better Auth data. Uses Better Auth's own context/adapter so hooks,
 * id generation, and secondary storage stay consistent.
 */
@Injectable()
export class AuthService {
  readonly staffOptions: core.StaffDeviceOptions;

  constructor(
    @Inject(BETTER_AUTH) readonly auth: AuthInstance,
    private readonly authPrisma: AuthPrismaClient,
    private readonly members: MemberRoleService,
    private readonly events: DomainEvents,
    config: ConfigService,
  ) {
    const { pinPepper, staffSessionHours } = config.getOrThrow<AppConfig>('app').auth;
    this.staffOptions = {
      pinPepper,
      staffSessionHours,
      onDeviceRevoked: (e) => this.events.emit('device.revoked', { restaurantId: e.organizationId, deviceId: e.deviceId }),
    };
  }

  /** Better Auth context typed as the generic AuthContext the staff-device core expects. */
  private async ctx(): Promise<AuthContext> {
    return (await this.auth.$context) as unknown as AuthContext;
  }

  // ── Staff ────────────────────────────────────────────────────────────────

  async listStaff(organizationId: string) {
    const members = await this.authPrisma.member.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const pins = await this.authPrisma.staffPin.findMany({ where: { organizationId }, select: { userId: true, lockedUntil: true } });
    const pinBy = new Map(pins.map((p) => [p.userId, p]));
    return members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`) ? null : m.user.email,
      role: m.role,
      hasPin: pinBy.has(m.userId),
      lockedUntil: pinBy.get(m.userId)?.lockedUntil ?? null,
      joinedAt: m.createdAt,
    }));
  }

  /**
   * Floor staff: placeholder email, NO credential account → password sign-in is impossible; PIN only.
   * Owner/manager: real email + password.
   */
  async createStaff(organizationId: string, input: { name: string; role: StaffRole; email?: string; password?: string; pin?: string }) {
    const ctx = await this.ctx();
    const isFloor = FLOOR_ROLES.includes(input.role);
    if (!isFloor && (!input.email || !input.password)) throw new BadRequestException('Owner/manager accounts need email and password');

    const email = (input.email ?? `${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`).toLowerCase();
    let user = await ctx.internalAdapter.findUserByEmail(email).then((r) => r?.user ?? null);
    if (!user) {
      user = await ctx.internalAdapter.createUser({ email, name: input.name, emailVerified: false }, { method: input.password ? 'email-password' : 'admin' });
      if (input.password) {
        const hash = await ctx.password.hash(input.password);
        await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
      }
    }
    const existing = await core.findMember(ctx, organizationId, user.id);
    if (existing) throw new BadRequestException('User is already a member of this restaurant');

    const member = await ctx.adapter.create<Omit<MemberRow, 'id'> & { createdAt: Date }, MemberRow>({
      model: 'member',
      data: { organizationId, userId: user.id, role: input.role, createdAt: new Date() },
    });
    if (input.pin) await core.setPin(ctx, this.staffOptions, { organizationId, userId: user.id, pin: input.pin });
    return { memberId: member.id, userId: user.id, name: user.name, role: member.role };
  }

  async getMember(organizationId: string, userId: string) {
    const member = await core.findMember(await this.ctx(), organizationId, userId);
    if (!member) throw new NotFoundException('Staff member not found');
    return member;
  }

  async countOwners(organizationId: string): Promise<number> {
    return this.authPrisma.member.count({ where: { organizationId, role: 'owner' } });
  }

  async updateStaff(organizationId: string, userId: string, input: { name?: string; role?: StaffRole }) {
    const ctx = await this.ctx();
    const member = await this.getMember(organizationId, userId);
    if (input.role && input.role !== member.role) {
      await ctx.adapter.update({ model: 'member', where: [{ field: 'id', value: member.id }], update: { role: input.role } });
      await this.members.invalidate(organizationId, userId);
    }
    if (input.name) await ctx.internalAdapter.updateUser(userId, { name: input.name });
  }

  /** Removes the membership and PIN, revokes this restaurant's sessions. The user row stays (soft refs). */
  async deactivateStaff(organizationId: string, userId: string) {
    const ctx = await this.ctx();
    const member = await this.getMember(organizationId, userId);
    const sessions = await ctx.adapter.findMany<{ token: string }>({
      model: 'session',
      where: [{ field: 'userId', value: userId }, { field: 'activeOrganizationId', value: organizationId }],
    });
    if (sessions.length) await ctx.internalAdapter.deleteSessions(sessions.map((s) => s.token));
    await ctx.adapter.deleteMany({ model: 'staffPin', where: [{ field: 'userId', value: userId }, { field: 'organizationId', value: organizationId }] });
    await ctx.adapter.delete({ model: 'member', where: [{ field: 'id', value: member.id }] });
    await this.members.invalidate(organizationId, userId);
    this.events.emit('staff.deactivated', { restaurantId: organizationId, userId });
  }

  async setPin(organizationId: string, userId: string, pin: string) {
    await this.getMember(organizationId, userId);
    await core.setPin(await this.ctx(), this.staffOptions, { organizationId, userId, pin });
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  async listDevices(organizationId: string) {
    const rows = await this.authPrisma.device.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    return rows.map(({ tokenHash: _t, ...d }) => d);
  }

  async registerDevice(organizationId: string, name: string, approvedBy: string) {
    const { device, token } = await core.registerDevice(await this.ctx(), { organizationId, name, approvedBy });
    const { tokenHash: _t, ...safe } = device as DeviceRow;
    return { device: safe, deviceToken: token }; // shown once
  }

  async revokeDevice(organizationId: string, deviceId: string) {
    const device = await core.revokeDevice(await this.ctx(), this.staffOptions, { organizationId, deviceId });
    if (!device) throw new NotFoundException('Device not found');
  }

  // ── Provisioning & maintenance ───────────────────────────────────────────

  /**
   * Creates owner user (email+password), organization, owner membership, then the Restaurant row
   * via the same hook the organization plugin runs. Used by scripts/provision-restaurant.ts.
   */
  async provisionRestaurant(input: { restaurantName: string; slug: string; ownerName: string; ownerEmail: string; ownerPassword: string },
    onCreated: (organizationId: string) => Promise<void>) {
    const ctx = await this.ctx();
    if (await this.authPrisma.organization.findUnique({ where: { slug: input.slug } })) throw new BadRequestException(`Slug "${input.slug}" is taken`);
    if (await ctx.internalAdapter.findUserByEmail(input.ownerEmail.toLowerCase())) throw new BadRequestException('Owner email already registered');

    const org = await ctx.adapter.create<{ name: string; slug: string; createdAt: Date }, { id: string }>({
      model: 'organization',
      data: { name: input.restaurantName, slug: input.slug, createdAt: new Date() },
    });
    try {
      const owner = await this.createStaff(org.id, { name: input.ownerName, role: 'owner', email: input.ownerEmail, password: input.ownerPassword });
      await onCreated(org.id);
      return { restaurantId: org.id, ownerUserId: owner.userId };
    } catch (e) {
      // Not one transaction (Better Auth adapter + app client), so compensate: org delete cascades memberships.
      await this.authPrisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
      throw e;
    }
  }

  /** Expired sessions and approvals (worker, maintenance queue). */
  async cleanupExpired(): Promise<{ sessions: number; approvals: number }> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [sessions, approvals] = await Promise.all([
      this.authPrisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.authPrisma.managerApproval.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { consumedAt: { lt: dayAgo } }] } }),
    ]);
    return { sessions: sessions.count, approvals: approvals.count };
  }
}
