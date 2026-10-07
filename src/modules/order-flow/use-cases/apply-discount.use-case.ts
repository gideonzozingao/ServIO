import { Injectable } from '@nestjs/common';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import { BillService } from '../../billing/bill.service.js';
import type { ApplyDiscountDto } from '../../billing/dto/billing.dto.js';
import { ManagerApprovalService } from '../../auth/manager-approval.service.js';

@Injectable()
export class ApplyDiscountUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly bills: BillService,
    private readonly approvals: ManagerApprovalService,
    private readonly audit: AuditService,
  ) {}

  async execute(
    s: RequestSession,
    billId: string,
    dto: ApplyDiscountDto,
    approvalToken: string | undefined,
  ) {
    await this.db.run(async (tx) => {
      const approverId = await this.approvals.consume(tx, {
        token: approvalToken,
        action: 'bill.discount',
        subjectId: billId,
      });
      const { before, after } = await this.bills.applyDiscount(tx, billId, {
        ...dto,
        approverId,
      });
      await this.audit.record(tx, {
        action: 'bill.discount',
        subjectType: 'bill',
        subjectId: billId,
        approverId,
        before: {
          discountMinor: before.discountMinor,
          totalMinor: before.totalMinor,
        },
        after: {
          discountMinor: after.discountMinor,
          totalMinor: after.totalMinor,
          reason: dto.reason,
          percentBps: dto.percentBps ?? null,
        },
      });
    });
    return this.bills.get(billId);
  }
}
