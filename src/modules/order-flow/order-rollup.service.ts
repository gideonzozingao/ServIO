import { TicketService } from './../kitchen/kitchen.service.js';
import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../common/types/tx.type.js';
import type { OrderStatus } from '../../database/prisma-client.js';
import { evt, type PendingEvent } from '../../infrastructure/events/domain-events.service.js';

import { OrderStateMachine } from '../orders/order-state-machine.js';

const KITCHEN_PHASE: OrderStatus[] = ['SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED'];

/** Recomputes the order status from its tickets (inside the caller's transaction). */
@Injectable()
export class OrderRollupService {
  constructor(private readonly tickets: TicketService, private readonly fsm: OrderStateMachine) {}

  async apply(tx: TenantTx, restaurantId: string, orderId: string, current: OrderStatus): Promise<{ status: OrderStatus; events: PendingEvent[] }> {
    // Billing/payment/void own the status once the order leaves the kitchen phase.
    if (current !== 'OPEN' && !KITCHEN_PHASE.includes(current)) return { status: current, events: [] };
    const next = this.fsm.rollup(await this.tickets.statusesForOrder(tx, orderId));
    if (!next || next === current) return { status: current, events: [] };
    await this.fsm.transition(tx, orderId, current, next);
    return { status: next, events: [evt('order.status.changed', { restaurantId, orderId, from: current, to: next })] };
  }
}
