import { TicketService } from './../../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import { DomainException, InvalidStateException } from '../../../common/exceptions/domain.exceptions.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { TERMINAL_ORDER_STATUSES } from '../../../common/types/order-status.js';
import { ItemStatus, OrderStatus, TicketStatus } from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import { DomainEvents, evt, type PendingEvent } from '../../../infrastructure/events/domain-events.service.js';
import { ManagerApprovalService } from '../../auth/manager-approval.service.js';
import { BillService } from '../../billing/bill.service.js';
import { FloorService } from '../../floor/floor.service.js';

import { OrderQueryService } from '../../orders/order-query.service.js';
import { OrderStateMachine } from '../../orders/order-state-machine.js';
import { OrdersService } from '../../orders/orders.service.js';

/** Soft-void: nothing financial is deleted. Requires a manager approval bound to this order. */
@Injectable()
export class VoidOrderUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketService,
    private readonly bills: BillService,
    private readonly floor: FloorService,
    private readonly approvals: ManagerApprovalService,
    private readonly fsm: OrderStateMachine,
    private readonly query: OrderQueryService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, orderId: string, reason: string, approvalToken: string | undefined) {
    const pending: PendingEvent[] = [];
    const order = await this.db.run(async (tx) => {
      const locked = await this.orders.getForUpdate(tx, orderId, s);
      if (TERMINAL_ORDER_STATUSES.includes(locked.status)) throw new InvalidStateException(`Order is already ${locked.status}`);

      const paid = await tx.payment.aggregate({ where: { bill: { orderId } }, _sum: { amountMinor: true } });
      if ((paid._sum.amountMinor ?? 0) > 0) throw new DomainException('Order has payments; refunds are not supported in the MVP', 'HAS_PAYMENTS');

      const approverId = await this.approvals.consume(tx, { token: approvalToken, action: 'order.void', subjectId: orderId });
      const now = new Date();

      const cancelled = await this.tickets.cancelForOrder(tx, orderId);
      await tx.orderItem.updateMany({
        where: { orderId, voidedAt: null },
        data: { voidedAt: now, voidedById: s.userId, voidReason: reason, status: ItemStatus.VOIDED },
      });
      await this.bills.voidOpenBills(tx, orderId);
      await this.fsm.transition(tx, orderId, locked.status, OrderStatus.VOIDED, { closedAt: now, voidReason: reason, voidedById: s.userId });

      if (locked.tableId) {
        const change = await this.floor.release(tx, locked.tableId, orderId);
        if (change) pending.push(evt('table.status.changed', { restaurantId: s.restaurantId, ...change }));
      }
      await this.audit.record(tx, {
        action: 'order.void', subjectType: 'order', subjectId: orderId, approverId,
        before: { status: locked.status, totalMinor: locked.totalMinor }, after: { status: OrderStatus.VOIDED, reason },
      });

      for (const t of cancelled) {
        pending.push(evt('ticket.updated', { restaurantId: s.restaurantId, ticketId: t.id, stationId: t.stationId, orderId, status: TicketStatus.CANCELLED }));
      }
      pending.push(
        evt('order.status.changed', { restaurantId: s.restaurantId, orderId, from: locked.status, to: OrderStatus.VOIDED }),
        evt('order.closed', { restaurantId: s.restaurantId, orderId, status: OrderStatus.VOIDED }),
      );
      return this.query.load(tx, orderId);
    });
    this.events.emitAll(pending);
    return this.query.respond(order);
  }
}
