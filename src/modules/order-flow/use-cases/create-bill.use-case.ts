import { Injectable } from '@nestjs/common';
import { DomainException, InvalidStateException } from '../../../common/exceptions/domain.exceptions.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { BILLABLE_ORDER_STATUSES } from '../../../common/types/order-status.js';
import { OrderItem, OrderStatus } from '../../../database/prisma-client.js';
import { TenantPrismaService } from '../../../database/tenant-prisma.service.js';
import { AuditService } from '../../../infrastructure/audit/audit.service.js';
import { DomainEvents, evt } from '../../../infrastructure/events/domain-events.service.js';
import { BillService } from '../../billing/bill.service.js';
import { OrderPricingService } from '../../orders/order-pricing.service.js';
import { OrderStateMachine } from '../../orders/order-state-machine.js';
import { OrdersService } from '../../orders/orders.service.js';

@Injectable()
export class CreateBillUseCase {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly orders: OrdersService,
    private readonly pricing: OrderPricingService,
    private readonly bills: BillService,
    private readonly fsm: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async execute(s: RequestSession, orderId: string) {
    const bill = await this.db.run(async (tx) => {
      const order = await this.orders.getForUpdate(tx, orderId, s);
      if (!BILLABLE_ORDER_STATUSES.includes(order.status)) throw new InvalidStateException(`Order is ${order.status}; it must be READY or SERVED to bill`);
      if (order.items.some((i:OrderItem) => i.ticketId === null && i.voidedAt === null)) {
        throw new DomainException('Order has unsent items; send or remove them first', 'UNSENT_ITEMS');
      }
      await this.pricing.recalc(tx, orderId); // never trust stale totals
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const created = await this.bills.createFromOrder(tx, fresh, s.userId);
      await this.fsm.transition(tx, orderId, order.status, OrderStatus.BILLED);
      await this.audit.record(tx, { action: 'bill.create', subjectType: 'bill', subjectId: created.id, after: { orderId, totalMinor: created.totalMinor } });
      return { created, from: order.status };
    });

    this.events.emitAll([
      evt('bill.created', { restaurantId: s.restaurantId, billId: bill.created.id, orderId, totalMinor: bill.created.totalMinor }),
      evt('order.status.changed', { restaurantId: s.restaurantId, orderId, from: bill.from, to: OrderStatus.BILLED }),
    ]);
    return this.bills.get(bill.created.id);
  }
}
