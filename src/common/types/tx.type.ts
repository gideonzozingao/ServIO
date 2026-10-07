import type { Prisma } from '../../database/prisma-client.js';

/** Transaction client handed to services. Always obtained from withTenant(), so RLS + tenant extension apply. */
export type TenantTx = Prisma.TransactionClient;

export type StaffRole = 'owner' | 'manager' | 'waiter' | 'kitchen' | 'cashier';
export const STAFF_ROLES: StaffRole[] = [
  'owner',
  'manager',
  'waiter',
  'kitchen',
  'cashier',
];
export const FLOOR_ROLES: StaffRole[] = ['waiter', 'kitchen', 'cashier'];
export const isStaffRole = (r: string): r is StaffRole =>
  (STAFF_ROLES as string[]).includes(r);

export interface RequestSession {
  sessionId: string;
  userId: string;
  restaurantId: string;
  role: StaffRole;
  deviceId: string | null;
}
