import { Injectable } from '@nestjs/common';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { OrderStatus } from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import {
  DomainEvents,
  evt,
  type PendingEvent,
} from '../../../infrastructure/events/domain-events.service.js';
import type { RecordPaymentDto } from '../../billing/dto/billing.dto.js';
import { PaymentService } from '../../billing/payment.service.js';
import { FloorService } from '../../floor/floor.service.js';
import { OrderStateMachine } from '../../orders/order-state-machine.js';

/** Partial payments allowed; the one that clears the balance closes the order and frees the table. */
@Injectable()
export class RecordPaymentUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly payments: PaymentService,
    private readonly floor: FloorService,
    private readonly fsm: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, billId: string, dto: RecordPaymentDto) {
    const pending: PendingEvent[] = [];
    const result = await this.db.run(async (tx) => {
      const r = await this.payments.record(tx, billId, dto, s.userId);
      await this.audit.record(tx, {
        action: 'payment.record',
        subjectType: 'bill',
        subjectId: billId,
        after: {
          paymentId: r.paymentId,
          method: dto.method,
          amountMinor: dto.amountMinor,
          reference: dto.reference ?? null,
        },
      });
      pending.push(
        evt('payment.recorded', {
          restaurantId: s.restaurantId,
          billId,
          paymentId: r.paymentId,
          method: dto.method,
          amountMinor: dto.amountMinor,
        }),
      );

      if (r.paidInFull) {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: r.orderId },
          select: { status: true, tableId: true },
        });
        await this.fsm.transition(
          tx,
          r.orderId,
          order.status,
          OrderStatus.PAID,
          { closedAt: new Date() },
        );
        if (order.tableId) {
          const change = await this.floor.release(tx, order.tableId, r.orderId);
          if (change)
            pending.push(
              evt('table.status.changed', {
                restaurantId: s.restaurantId,
                ...change,
              }),
            );
        }
        pending.push(
          evt('bill.paid', {
            restaurantId: s.restaurantId,
            billId,
            orderId: r.orderId,
          }),
          evt('order.status.changed', {
            restaurantId: s.restaurantId,
            orderId: r.orderId,
            from: order.status,
            to: OrderStatus.PAID,
          }),
          evt('order.closed', {
            restaurantId: s.restaurantId,
            orderId: r.orderId,
            status: OrderStatus.PAID,
          }),
        );
      }
      return r;
    });
    this.events.emitAll(pending);
    return result;
  }
}
