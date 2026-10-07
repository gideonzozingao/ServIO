import { APPROVAL_ACTIONS } from './../../../../../common/decorators/requires-approval/requires-approval.decorator.js';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

import {
  APPROVER_ROLES,
  checkPin,
  createApproval,
  findMember,
  resolveDevice,
  type StaffDeviceOptions,
} from '../staff-device.core.js';
import type { StaffRole } from '../../../../../common/types/tx.type.js';

const Body = z.object({
  deviceToken: z.string().min(20),
  approverId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/),
  action: z.enum(APPROVAL_ACTIONS as [string, ...string[]]),
  subjectId: z.string().uuid(),
});

/**
 * POST /api/auth/staff/manager-approval
 * Manager types their PIN on the waiter's device → short-lived, single-use token bound to
 * (restaurant, action, subject). Consumed by the API inside the action's transaction.
 */
export const managerApprovalEndpoint = (opts: StaffDeviceOptions) =>
  createAuthEndpoint(
    '/staff/manager-approval',
    { method: 'POST', body: Body },
    async (ctx) => {
      const device = await resolveDevice(ctx.context, ctx.body.deviceToken);
      if (!device)
        throw new APIError('UNAUTHORIZED', {
          message: 'Unknown or revoked device',
        });

      const member = await findMember(
        ctx.context,
        device.organizationId,
        ctx.body.approverId,
      );
      const denied = new APIError('FORBIDDEN', { message: 'Approval denied' });
      if (!member || !APPROVER_ROLES.includes(member.role as StaffRole))
        throw denied;

      const result = await checkPin(ctx.context, opts, {
        organizationId: device.organizationId,
        userId: member.userId,
        pin: ctx.body.pin,
      });
      if (result === 'locked')
        throw new APIError('TOO_MANY_REQUESTS', {
          message: 'Too many attempts. Try again later.',
        });
      if (result !== 'ok') throw denied;

      const { token, expiresAt } = await createApproval(ctx.context, opts, {
        organizationId: device.organizationId,
        approverId: member.userId,
        action: ctx.body.action,
        subjectId: ctx.body.subjectId,
      });
      return ctx.json({ approvalToken: token, expiresAt });
    },
  );
