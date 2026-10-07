import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../database/prisma-client.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { rid } from '../../database/tenant-scope.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export interface AuditEntry {
  action: string; // order.void, bill.discount, menu.price_change, ...
  subjectType: string;
  subjectId?: string | null;
  userId?: string | null;     // defaults to the current session user
  approverId?: string | null;
  deviceId?: string | null;   // defaults to the current session device
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** Writes inside the caller's transaction so the action and its audit row commit together. */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: TenantContext) {}

  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    const session = this.ctx.tryGet();
    await tx.auditLog.create({
      data: {
        restaurantId: rid(),
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId ?? null,
        userId: entry.userId ?? session?.userId ?? null,
        approverId: entry.approverId ?? null,
        deviceId: entry.deviceId ?? session?.deviceId ?? null,
        before: entry.before,
        after: entry.after,
      },
    });
  }
}
