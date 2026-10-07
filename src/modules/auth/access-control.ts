import { createAccessControl } from 'better-auth/plugins/access';
import type { StaffRole } from '../../common/types/tx.type.js';

/** Move to packages/shared-types so clients can hide UI. The server remains the only enforcement point. */
export const statement = {
  menu: ['read', 'manage'],
  order: ['create', 'update', 'void'],
  ticket: ['read', 'update'],
  bill: ['create', 'pay', 'discount'],
  report: ['read'],
  staff: ['manage'],
  settings: ['manage'],
} as const;

export type Statement = typeof statement;

export const ac = createAccessControl(statement);

export const roles = {
  owner: ac.newRole({
    menu: ['read', 'manage'],
    order: ['create', 'update', 'void'],
    ticket: ['read', 'update'],
    bill: ['create', 'pay', 'discount'],
    report: ['read'],
    staff: ['manage'],
    settings: ['manage'],
  }),
  manager: ac.newRole({
    menu: ['read', 'manage'],
    order: ['create', 'update', 'void'],
    ticket: ['read', 'update'],
    bill: ['create', 'pay', 'discount'],
    report: ['read'],
  }),
  waiter: ac.newRole({
    menu: ['read'],
    order: ['create', 'update'],
    ticket: ['read'],
    bill: ['create'],
  }),
  kitchen: ac.newRole({ menu: ['read'], ticket: ['read', 'update'] }),
  cashier: ac.newRole({
    menu: ['read'],
    order: ['update'],
    bill: ['create', 'pay'],
  }),
} satisfies Record<StaffRole, unknown>;

export function hasPermission<R extends keyof Statement>(
  role: StaffRole,
  resource: R,
  action: Statement[R][number],
): boolean {
  return roles[role].authorize({ [resource]: [action] } as never).success;
}

/** Flattened permission list for GET /me (client UI gating). */
export function permissionsFor(role: StaffRole): string[] {
  const out: string[] = [];
  for (const resource of Object.keys(statement) as (keyof Statement)[]) {
    for (const action of statement[resource]) {
      if (hasPermission(role, resource, action as never))
        out.push(`${resource}:${action}`);
    }
  }
  return out;
}
