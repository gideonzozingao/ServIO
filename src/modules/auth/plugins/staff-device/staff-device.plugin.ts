import type { BetterAuthPlugin } from 'better-auth';
import { managerApprovalEndpoint } from './endpoints/manager-approval.js';
import { pinLoginEndpoint } from './endpoints/pin-login.js';
import { rosterEndpoint } from './endpoints/roster.js';

import { staffDeviceSchema } from './schema.js';
import type { StaffDeviceOptions } from './staff-device.core.js';

/**
 * Device-bound PIN login + manager approvals, inside Better Auth's session model.
 *
 * Device-facing endpoints live here (/api/auth/staff/*). Admin operations (register/revoke device,
 * set PIN, create staff) are exposed under /api/v1 by StaffModule → AuthService, so they get the same
 * Nest permission checks and audit as the rest of the API. Both call staff-device.core.
 */
export const staffDevice = (opts: StaffDeviceOptions) =>
  ({
    id: 'staff-device',
    schema: staffDeviceSchema,
    endpoints: {
      staffRoster: rosterEndpoint(),
      staffPinLogin: pinLoginEndpoint(opts),
      staffManagerApproval: managerApprovalEndpoint(opts),
    },
    rateLimit: [
      { pathMatcher: (path: string) => path === '/staff/pin-login' || path === '/staff/manager-approval', window: 60, max: 5 },
      { pathMatcher: (path: string) => path === '/staff/roster', window: 60, max: 30 },
    ],
  }) satisfies BetterAuthPlugin;

export type { StaffDeviceOptions } from './staff-device.core.js';
