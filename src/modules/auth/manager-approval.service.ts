import { ApprovalAction } from './../../common/decorators/requires-approval/requires-approval.decorator.js';
import { ForbiddenException, Injectable } from '@nestjs/common';
// import type { ApprovalAction } from '../../common/decorators/requires-approval.decorator.js';

import type { TenantTx } from '../../common/types/tx.type.js';
import { tenantScope } from '../../database/tenant-scope.js';
import { sha256 } from './plugins/staff-device/pin-hasher.js';

/**
 * Verifies AND consumes an approval token in ONE statement, inside the caller's transaction:
 * if the action later rolls back, the token is not consumed. Bound to restaurant + action + subject.
 * (servio_app has UPDATE(consumed_at) on manager_approval; see rls.sql.)
 */
@Injectable()
export class ManagerApprovalService {
  async consume(
    tx: TenantTx,
    input: {
      token: string | undefined;
      action: ApprovalAction;
      subjectId: string;
    },
  ): Promise<string> {
    if (!input.token)
      throw new ForbiddenException({
        message: 'Manager approval required',
        code: 'APPROVAL_REQUIRED',
      });
    const restaurantId = tenantScope.require();
    const rows = await tx.$queryRaw<{ approver_id: string }[]>`
      UPDATE manager_approval
         SET consumed_at = now()
       WHERE token_hash = ${sha256(input.token)}
         AND organization_id = ${restaurantId}::uuid
         AND action = ${input.action}
         AND subject_id = ${input.subjectId}::uuid
         AND consumed_at IS NULL
         AND expires_at > now()
   RETURNING approver_id::text`;
    if (rows.length !== 1)
      throw new ForbiddenException({
        message: 'Approval invalid, expired, or already used',
        code: 'APPROVAL_INVALID',
      });
    return rows[0].approver_id;
  }
}
