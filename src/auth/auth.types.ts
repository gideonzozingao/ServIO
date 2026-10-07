import type { Request } from 'express';
import type { createAuth } from './auth.factory.js';

export type Auth = ReturnType<typeof createAuth>;

export type StaffRole = 'owner' | 'manager' | 'waiter' | 'kitchen' | 'cashier';

export interface AuthedRequest extends Request {
  authUser: { id: string; email: string; name: string };
  authSession: { id: string; activeOrganizationId?: string | null };
  tenant?: { organizationId: string; role: string };
}
