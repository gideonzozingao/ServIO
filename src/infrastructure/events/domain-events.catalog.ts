import type {
  OrderStatus,
  PaymentMethod,
  TableStatus,
  TicketStatus,
} from '../../database/prisma-client.js';

/** Every payload carries restaurantId so listeners can route to tenant rooms without lookups. */
interface Base {
  restaurantId: string;
}

export interface DomainEventMap {
  'order.created': Base & {
    orderId: string;
    number: number;
    tableId: string | null;
    type: string;
  };
  'order.items.changed': Base & { orderId: string };
  'order.sent': Base & { orderId: string; ticketIds: string[] };
  'order.status.changed': Base & {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
  };
  'order.closed': Base & { orderId: string; status: OrderStatus };
  'ticket.created': Base & {
    ticketId: string;
    stationId: string;
    orderId: string;
    round: number;
  };
  'ticket.updated': Base & {
    ticketId: string;
    stationId: string;
    orderId: string;
    status: TicketStatus;
  };
  'ticket.ready': Base & {
    ticketId: string;
    stationId: string;
    orderId: string;
    orderNumber: number;
    tableLabel: string | null;
    waiterId: string;
  };
  'table.status.changed': Base & { tableId: string; status: TableStatus };
  'menu.updated': Base;
  'menu.item.availability.changed': Base & {
    menuItemId: string;
    available: boolean;
  };
  'bill.created': Base & {
    billId: string;
    orderId: string;
    totalMinor: number;
  };
  'payment.recorded': Base & {
    billId: string;
    paymentId: string;
    method: PaymentMethod;
    amountMinor: number;
  };
  'bill.paid': Base & { billId: string; orderId: string };
  'device.revoked': Base & { deviceId: string };
  'staff.deactivated': Base & { userId: string };
  'settings.updated': Base;
}

export type DomainEventName = keyof DomainEventMap;
