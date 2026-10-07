import { TicketService } from './../../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import {
  EntityNotFoundException,
  InvalidStateException,
} from '../../../common/exceptions/domain.exceptions.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { EDITABLE_ORDER_STATUSES } from '../../../common/types/order-status.js';
import {
  ItemStatus,
  KitchenTicket,
  OrderItem,
  TicketStatus,
} from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import {
  DomainEvents,
  evt,
  type PendingEvent,
} from '../../../infrastructure/events/domain-events.service.js';
import { ManagerApprovalService } from '../../auth/manager-approval.service.js';

import { OrderPricingService } from '../../orders/order-pricing.service.js';
import { OrderQueryService } from '../../orders/order-query.service.js';
import { OrdersService } from '../../orders/orders.service.js';
import { OrderRollupService } from '../order-rollup.service.js';

/**
 * Void one line. Unsent items: no approval needed (prefer DELETE). Sent items: manager approval bound to the item.
 * (Open point: approval only once PREPARING — change the `needsApproval` rule here.)
 */
@Injectable()
export class VoidItemUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketService,
    private readonly pricing: OrderPricingService,
    private readonly rollup: OrderRollupService,
    private readonly approvals: ManagerApprovalService,
    private readonly query: OrderQueryService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async execute(
    s: RequestSession,
    orderId: string,
    itemId: string,
    reason: string,
    approvalToken: string | undefined,
  ) {
    const pending: PendingEvent[] = [];
    const order = await this.db.run(async (tx) => {
      const locked = await this.orders.getForUpdate(tx, orderId, s);
      if (!EDITABLE_ORDER_STATUSES.includes(locked.status))
        throw new InvalidStateException(
          `Order is ${locked.status}; void the bill/order instead`,
        );
      const item = locked.items.find((i: OrderItem) => i.id === itemId);
      if (!item || item.voidedAt)
        throw new EntityNotFoundException('Order item', itemId);

      const needsApproval = item.ticketId !== null;
      const approverId = needsApproval
        ? await this.approvals.consume(tx, {
            token: approvalToken,
            action: 'item.void',
            subjectId: itemId,
          })
        : null;

      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          voidedAt: new Date(),
          voidedById: s.userId,
          voidReason: reason,
          status: ItemStatus.VOIDED,
        },
      });
      if (item.ticketId) {
        const cancelled = await this.tickets.cancelIfEmpty(tx, item.ticketId);
        if (cancelled)
          pending.push(
            evt('ticket.updated', {
              restaurantId: s.restaurantId,
              ticketId: cancelled.id,
              stationId: cancelled.stationId,
              orderId,
              status: TicketStatus.CANCELLED,
            }),
          );
        else {
          const t = locked.tickets.find(
            (x: KitchenTicket) => x.id === item.ticketId,
          );
          if (t)
            pending.push(
              evt('ticket.updated', {
                restaurantId: s.restaurantId,
                ticketId: t.id,
                stationId: t.stationId,
                orderId,
                status: t.status,
              }),
            );
        }
      }
      await this.pricing.recalc(tx, orderId);
      pending.push(
        ...(await this.rollup.apply(tx, s.restaurantId, orderId, locked.status))
          .events,
      );
      await this.audit.record(tx, {
        action: 'item.void',
        subjectType: 'order_item',
        subjectId: itemId,
        approverId,
        before: {
          name: item.nameSnapshot,
          qty: item.qty,
          lineTotalMinor: item.lineTotalMinor,
          sent: needsApproval,
        },
        after: { reason },
      });
      pending.push(
        evt('order.items.changed', { restaurantId: s.restaurantId, orderId }),
      );
      return this.query.load(tx, orderId);
    });
    this.events.emitAll(pending);
    return this.query.respond(order);
  }
}
