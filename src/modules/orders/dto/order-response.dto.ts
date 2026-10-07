import type { Prisma } from '../../../database/prisma-client.js';
import { dbDateToIso } from '../../../common/utils/business-date.util.js';

export const ORDER_DETAIL_INCLUDE = {
  table: { select: { id: true, label: true } },
  items: { orderBy: { createdAt: 'asc' }, include: { modifiers: true } },
  tickets: {
    orderBy: [{ round: 'asc' }, { firedAt: 'asc' }],
    include: { station: { select: { id: true, name: true } } },
  },
  bills: {
    orderBy: { createdAt: 'asc' },
    include: { payments: { orderBy: { paidAt: 'asc' } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{
  include: typeof ORDER_DETAIL_INCLUDE;
}>;

/** Explicit response shape: never return raw Prisma rows. */
export function toOrderResponse(
  o: OrderDetail,
  names: Map<string, string> = new Map(),
) {
  return {
    id: o.id,
    number: o.number,
    businessDate: dbDateToIso(o.businessDate),
    type: o.type,
    status: o.status,
    table: o.table,
    waiter: { id: o.waiterId, name: names.get(o.waiterId) ?? null },
    covers: o.covers,
    customerNote: o.customerNote,
    totals: {
      subtotalMinor: o.subtotalMinor,
      discountMinor: o.discountMinor,
      taxMinor: o.taxMinor,
      totalMinor: o.totalMinor,
    },
    voidReason: o.voidReason,
    openedAt: o.openedAt,
    sentAt: o.sentAt,
    closedAt: o.closedAt,
    items: o.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      name: i.nameSnapshot,
      qty: i.qty,
      unitPriceMinor: i.unitPriceMinor,
      lineTotalMinor: i.lineTotalMinor,
      notes: i.notes,
      status: i.status,
      sent: i.ticketId !== null,
      ticketId: i.ticketId,
      voided: i.voidedAt !== null,
      voidReason: i.voidReason,
      modifiers: i.modifiers.map((m) => ({
        name: m.nameSnapshot,
        priceDeltaMinor: m.priceDeltaMinor,
      })),
    })),
    tickets: o.tickets.map((t) => ({
      id: t.id,
      station: t.station,
      round: t.round,
      status: t.status,
      firedAt: t.firedAt,
      readyAt: t.readyAt,
    })),
    bills: o.bills.map((b) => ({
      id: b.id,
      number: b.number,
      status: b.status,
      totalMinor: b.totalMinor,
      paidMinor: b.payments.reduce((s, p) => s + p.amountMinor, 0),
    })),
  };
}

export type OrderResponse = ReturnType<typeof toOrderResponse>;
