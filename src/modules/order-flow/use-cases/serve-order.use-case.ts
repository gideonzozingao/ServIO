import { TicketService } from './../../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exceptions.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { Order, TicketStatus } from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import {
  DomainEvents,
  evt,
  type PendingEvent,
} from '../../../infrastructure/events/domain-events.service.js';

import { OrderQueryService } from '../../orders/order-query.service.js';
import { OrdersService } from '../../orders/orders.service.js';
import { OrderRollupService } from '../order-rollup.service.js';

/** Waiter delivered the food: every READY ticket (and its items) → SERVED. */
@Injectable()
export class ServeOrderUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketService,
    private readonly rollup: OrderRollupService,
    private readonly query: OrderQueryService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, orderId: string) {
    const pending: PendingEvent[] = [];
    const order = await this.db.run(async (tx) => {
      const locked = await this.orders.getForUpdate(tx, orderId, s);
      const ready = locked.tickets.filter(
        (t) => t.status === TicketStatus.READY,
      );
      if (!ready.length)
        throw new DomainException('No ready tickets to serve', 'NOTHING_READY');
      for (const t of ready) {
        await this.tickets.setStatus(tx, t.id, TicketStatus.SERVED);
        pending.push(
          evt('ticket.updated', {
            restaurantId: s.restaurantId,
            ticketId: t.id,
            stationId: t.stationId,
            orderId,
            status: TicketStatus.SERVED,
          }),
        );
      }
      pending.push(
        ...(await this.rollup.apply(tx, s.restaurantId, orderId, locked.status))
          .events,
      );
      return this.query.load(tx, orderId);
    });
    this.events.emitAll(pending);
    return this.query.respond(order);
  }
}
