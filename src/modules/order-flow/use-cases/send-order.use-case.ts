import { TicketService } from './../../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import { DomainException, InvalidStateException } from '../../../common/exceptions/domain.exceptions.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { EDITABLE_ORDER_STATUSES } from '../../../common/types/order-status.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import { DomainEvents, evt, type PendingEvent } from '../../../infrastructure/events/domain-events.service.js';
import { FloorService } from '../../floor/floor.service.js';
import { OrderQueryService } from '../../orders/order-query.service.js';
import { OrdersService } from '../../orders/orders.service.js';
import { OrderRollupService } from '../order-rollup.service.js';
import { OrderItem } from '../../../database/prisma-client.js';

/**
 * Fires every unsent item (ticketId IS NULL) as the next round: one ticket per station.
 * Note: "unsent" is ticketId = null, not status = PENDING — sent-but-not-started items are also PENDING.
 */
@Injectable()
export class SendOrderUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketService,
    private readonly floor: FloorService,
    private readonly rollup: OrderRollupService,
    private readonly query: OrderQueryService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, orderId: string) {
    const pending: PendingEvent[] = [];
    const result = await this.db.run(async (tx) => {
      const order = await this.orders.getForUpdate(tx, orderId, s);
      if (!EDITABLE_ORDER_STATUSES.includes(order.status)) throw new InvalidStateException(`Order is ${order.status} and cannot be sent`);

      const unsent = order.items.filter((i:OrderItem) => i.ticketId === null && i.voidedAt === null);
      if (!unsent.length) throw new DomainException('Nothing to send', 'NOTHING_TO_SEND');

      const fired = await this.tickets.fire(tx, order.id, unsent);
      await this.orders.markSent(tx, order, fired);
      if (order.tableId) {
        const change = await this.floor.occupy(tx, order.tableId, order.id);
        if (change) pending.push(evt('table.status.changed', { restaurantId: s.restaurantId, ...change }));
      }
      const { events } = await this.rollup.apply(tx, s.restaurantId, order.id, order.status);
      pending.push(...events);

      await this.audit.record(tx, {
        action: 'order.send', subjectType: 'order', subjectId: order.id,
        after: { round: fired[0].round, tickets: fired.map((f) => ({ id: f.ticketId, stationId: f.stationId, items: f.itemIds.length })) },
      });

      pending.push(evt('order.sent', { restaurantId: s.restaurantId, orderId: order.id, ticketIds: fired.map((f) => f.ticketId) }));
      for (const f of fired) {
        pending.push(evt('ticket.created', { restaurantId: s.restaurantId, ticketId: f.ticketId, stationId: f.stationId, orderId: order.id, round: f.round }));
      }
      return { order: await this.query.load(tx, order.id), fired };
    });

    this.events.emitAll(pending); // after commit
    return { order: await this.query.respond(result.order), tickets: result.fired.map((f) => ({ id: f.ticketId, stationId: f.stationId, round: f.round })) };
  }
}
