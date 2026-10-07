import { Injectable } from '@nestjs/common';
import { DomainConflictException, InvalidStateException } from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { OrderStatus, TicketStatus } from '../../database/prisma-client.js';

const S = OrderStatus;

export { BILLABLE_ORDER_STATUSES, EDITABLE_ORDER_STATUSES, OPEN_ORDER_STATUSES, TERMINAL_ORDER_STATUSES } from '../../common/types/order-status.js';

/**
 * v4 transitions, extended for multi-round orders: adding items after READY/SERVED and sending again
 * moves the order back into the kitchen phase (rollup decides the exact status).
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  OPEN: [S.SENT_TO_KITCHEN, S.CANCELLED, S.VOIDED],
  SENT_TO_KITCHEN: [S.PREPARING, S.READY, S.SERVED, S.VOIDED],
  PREPARING: [S.SENT_TO_KITCHEN, S.READY, S.SERVED, S.VOIDED],
  READY: [S.SENT_TO_KITCHEN, S.PREPARING, S.SERVED, S.BILLED, S.VOIDED],
  SERVED: [S.SENT_TO_KITCHEN, S.PREPARING, S.READY, S.BILLED, S.VOIDED],
  BILLED: [S.PAID, S.VOIDED],
  PAID: [],
  CANCELLED: [],
  VOIDED: [],
};

@Injectable()
export class OrderStateMachine {
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return from === to || TRANSITIONS[from].includes(to);
  }

  assertCan(from: OrderStatus, to: OrderStatus): void {
    if (!this.canTransition(from, to)) throw new InvalidStateException(`Invalid order transition ${from} -> ${to}`);
  }

  /**
   * Race-safe transition: only applies if the row is still in `from`.
   * Returns true when the status actually changed.
   */
  async transition(tx: TenantTx, orderId: string, from: OrderStatus, to: OrderStatus, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (from === to) return false;
    this.assertCan(from, to);
    const n = await tx.order.updateMany({ where: { id: orderId, status: from }, data: { status: to, ...extra } });
    if (n.count !== 1) throw new DomainConflictException('Order changed concurrently, please retry', 'ORDER_CONFLICT');
    return true;
  }

  /** Order status derived from its active (non-cancelled) tickets. null = no kitchen work. */
  rollup(ticketStatuses: TicketStatus[]): OrderStatus | null {
    const active = ticketStatuses.filter((t) => t !== TicketStatus.CANCELLED);
    if (!active.length) return null;
    if (active.includes(TicketStatus.PREPARING)) return S.PREPARING;
    if (active.includes(TicketStatus.NEW)) return S.SENT_TO_KITCHEN;
    return active.every((t) => t === TicketStatus.SERVED) ? S.SERVED : S.READY;
  }
}
