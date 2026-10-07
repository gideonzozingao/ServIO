/**
 * Plugin schema → emitted into auth.prisma by `npx @better-auth/cli generate`.
 * Keys are Better Auth model names; with the Prisma adapter they map to client delegates
 * (device, staffPin, managerApproval). Column snake_case mapping lives in auth.prisma (@map).
 */
export const staffDeviceSchema = {
  device: {
    fields: {
      organizationId: {
        type: 'string',
        required: true,
        references: { model: 'organization', field: 'id', onDelete: 'cascade' },
      },
      name: { type: 'string', required: true },
      tokenHash: { type: 'string', required: true, unique: true },
      approvedBy: { type: 'string', required: false },
      approvedAt: { type: 'date', required: false },
      lastSeenAt: { type: 'date', required: false },
      revokedAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true },
    },
  },
  staffPin: {
    fields: {
      userId: {
        type: 'string',
        required: true,
        references: { model: 'user', field: 'id', onDelete: 'cascade' },
      },
      organizationId: {
        type: 'string',
        required: true,
        references: { model: 'organization', field: 'id', onDelete: 'cascade' },
      },
      pinHash: { type: 'string', required: true },
      failedAttempts: { type: 'number', required: true, defaultValue: 0 },
      lockedUntil: { type: 'date', required: false },
      updatedAt: { type: 'date', required: true },
    },
  },
  managerApproval: {
    fields: {
      organizationId: {
        type: 'string',
        required: true,
        references: { model: 'organization', field: 'id', onDelete: 'cascade' },
      },
      approverId: { type: 'string', required: true },
      action: { type: 'string', required: true },
      subjectId: { type: 'string', required: true },
      tokenHash: { type: 'string', required: true, unique: true },
      expiresAt: { type: 'date', required: true },
      consumedAt: { type: 'date', required: false },
      createdAt: { type: 'date', required: true },
    },
  },
  session: {
    fields: {
      deviceId: { type: 'string', required: false },
    },
  },
} as const;

export interface DeviceRow {
  id: string;
  organizationId: string;
  name: string;
  tokenHash: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface StaffPinRow {
  id: string;
  userId: string;
  organizationId: string;
  pinHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  updatedAt: Date;
}

export interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}
