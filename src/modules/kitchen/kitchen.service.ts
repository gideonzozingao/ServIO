import { Injectable } from '@nestjs/common';
import { DomainConflictException, EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { ItemStatus, TicketStatus } from '../../database/prisma-client.js';
import { rid } from '../../database/tenant-scope.js';
import { ITEM_STATUS_FOR_TICKET, TicketStateMachine } from './ticket-state-machine.js';

export interface FiredTicket {
  ticketId: string;
  stationId: string;
  round: number;
  itemIds: string[];
}

/** Ticket persistence primitives. The caller (order-flow) owns the transaction and the order rollup. */
@Injectable()
export class TicketService {
  constructor(private readonly fsm: TicketStateMachine) {}

  /** Groups items by their menu item's station → one ticket per station for the next round. */
  async fire(tx: TenantTx, orderId: string, items: { id: string; menuItemId: string }[]): Promise<FiredTicket[]> {
    const menuItems = await tx.menuItem.findMany({ where: { id: { in: [...new Set(items.map((i) => i.menuItemId))] } }, select: { id: true, stationId: true } });
    const stationOf = new Map(menuItems.map((m) => [m.id, m.stationId]));

    const byStation = new Map<string, string[]>();
    for (const item of items) {
      const stationId = stationOf.get(item.menuItemId);
      if (!stationId) throw new EntityNotFoundException('Menu item', item.menuItemId);
      byStation.set(stationId, [...(byStation.get(stationId) ?? []), item.id]);
    }

    const last = await tx.kitchenTicket.aggregate({ where: { orderId }, _max: { round: true } });
    const round = (last._max.round ?? 0) + 1;

    const fired: FiredTicket[] = [];
    for (const [stationId, itemIds] of byStation) {
      const t = await tx.kitchenTicket.create({ data: { restaurantId: rid(), orderId, stationId, round }, select: { id: true } });
      fired.push({ ticketId: t.id, stationId, round, itemIds });
    }
    return fired;
  }

  /** Validated, race-safe status change; mirrors status onto the ticket's (non-voided) items. */
  async setStatus(tx: TenantTx, ticketId: string, to: TicketStatus) {
    const ticket = await tx.kitchenTicket.findFirst({ where: { id: ticketId } });
    if (!ticket) throw new EntityNotFoundException('Kitchen ticket', ticketId);
    if (ticket.status === to) return { ticket, changed: false };
    this.fsm.assertCan(ticket.status, to);

    const now = new Date();
    const stamps =
      to === TicketStatus.PREPARING ? { startedAt: ticket.startedAt ?? now, readyAt: null }
      : to === TicketStatus.READY ? { readyAt: now }
      : to === TicketStatus.SERVED ? { servedAt: now }
      : to === TicketStatus.NEW ? { startedAt: null }
      : {};
    const n = await tx.kitchenTicket.updateMany({ where: { id: ticketId, status: ticket.status }, data: { status: to, ...stamps } });
    if (n.count !== 1) throw new DomainConflictException('Ticket changed concurrently, please retry', 'TICKET_CONFLICT');

    const itemStatus = ITEM_STATUS_FOR_TICKET[to];
    if (itemStatus) await tx.orderItem.updateMany({ where: { ticketId, voidedAt: null }, data: { status: itemStatus } });

    return { ticket: { ...ticket, status: to, ...stamps }, changed: true };
  }

  /** Void path: cancel every unfinished ticket of an order. */
  async cancelForOrder(tx: TenantTx, orderId: string) {
    const open = await tx.kitchenTicket.findMany({
      where: { orderId, status: { in: [TicketStatus.NEW, TicketStatus.PREPARING, TicketStatus.READY] } },
      select: { id: true, stationId: true },
    });
    if (open.length) await tx.kitchenTicket.updateMany({ where: { id: { in: open.map((t) => t.id) } }, data: { status: TicketStatus.CANCELLED } });
    return open;
  }

  /** After an item void: cancel the ticket if nothing active is left on it. */
  async cancelIfEmpty(tx: TenantTx, ticketId: string) {
    const remaining = await tx.orderItem.count({ where: { ticketId, voidedAt: null, status: { not: ItemStatus.VOIDED } } });
    if (remaining) return null;
    const n = await tx.kitchenTicket.updateMany({
      where: { id: ticketId, status: { notIn: [TicketStatus.SERVED, TicketStatus.CANCELLED] } },
      data: { status: TicketStatus.CANCELLED },
    });
    return n.count ? tx.kitchenTicket.findUniqueOrThrow({ where: { id: ticketId }, select: { id: true, stationId: true } }) : null;
  }

  async statusesForOrder(tx: TenantTx, orderId: string): Promise<TicketStatus[]> {
    const rows = await tx.kitchenTicket.findMany({ where: { orderId }, select: { status: true } });
    return rows.map((r) => r.status);
  }
}
