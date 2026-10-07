import { TicketService } from './../../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { TicketStatus } from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { DomainEvents, evt, type PendingEvent } from '../../../infrastructure/events/domain-events.service.js';
// import { TicketService } from '../../kitchen/ticket.service.js';
import { OrderRollupService } from '../order-rollup.service.js';

/** KDS bump (NEW → PREPARING → READY → SERVED, or recall). Rolls up to items and the order in one transaction. */
@Injectable()
export class AdvanceTicketUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly tickets: TicketService,
    private readonly rollup: OrderRollupService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, ticketId: string, to: TicketStatus) {
    const pending: PendingEvent[] = [];
    const result = await this.db.run(async (tx) => {
      const { ticket, changed } = await this.tickets.setStatus(tx, ticketId, to);
      if (!changed) return { ticketId, status: ticket.status, orderStatus: null };

      const order = await tx.order.findUniqueOrThrow({
        where: { id: ticket.orderId },
        select: { id: true, number: true, status: true, waiterId: true, table: { select: { label: true } } },
      });
      const { status, events } = await this.rollup.apply(tx, s.restaurantId, order.id, order.status);
      pending.push(evt('ticket.updated', { restaurantId: s.restaurantId, ticketId, stationId: ticket.stationId, orderId: order.id, status: to }));
      if (to === TicketStatus.READY) {
        pending.push(evt('ticket.ready', {
          restaurantId: s.restaurantId, ticketId, stationId: ticket.stationId, orderId: order.id,
          orderNumber: order.number, tableLabel: order.table?.label ?? null, waiterId: order.waiterId,
        }));
      }
      pending.push(...events);
      return { ticketId, status: to, orderStatus: status };
    });
    this.events.emitAll(pending);
    return result;
  }
}
