import { Injectable } from '@nestjs/common';
import { DomainException, EntityNotFoundException, InvalidStateException } from '../../common/exceptions/domain.exceptions.js';
import type { RequestSession, TenantTx } from '../../common/types/tx.type.js';
import { CounterScope, ItemStatus, OrderStatus, OrderType } from '../../database/prisma-client.js';
import { DocumentNumberService } from '../../database/document-number.service.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import { DomainEvents, evt, type PendingEvent } from '../../infrastructure/events/domain-events.service.js';
import { MenuQueryService, type PricedLine } from '../catalog/menu-query.service.js';
import { FloorService } from '../floor/floor.service.js';
import { RestaurantSettingsService } from '../settings/restaurant-settings.service.js';
import type { AddItemDto, CreateOrderDto } from './dto/create-order.dto.js';
import type { UpdateItemDto } from './dto/update-item.dto.js';
import { OrderPricingService } from './order-pricing.service.js';
import { OrderQueryService } from './order-query.service.js';
import { EDITABLE_ORDER_STATUSES, OrderStateMachine } from './order-state-machine.js';

export type LockedOrder = Awaited<ReturnType<OrdersService['getForUpdate']>>;

/** Draft-order writes (items while not billed) + primitives used by order-flow use cases. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly settings: RestaurantSettingsService,
    private readonly menu: MenuQueryService,
    private readonly pricing: OrderPricingService,
    private readonly floor: FloorService,
    private readonly query: OrderQueryService,
    private readonly fsm: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // ── Commands (own transaction) ───────────────────────────────────────────

  async create(s: RequestSession, dto: CreateOrderDto) {
    const pending: PendingEvent[] = [];
    const order = await this.db.run(async (tx) => {
      const bd = await this.settings.businessDate(tx);
      const number = await this.numbers.next(tx, CounterScope.ORDER, bd.date);
      const tableId = dto.type === OrderType.DINE_IN ? dto.tableId! : null;

      const created = await tx.order.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          restaurantId: rid(),
          number,
          businessDate: bd.date,
          type: dto.type,
          tableId,
          waiterId: s.userId,
          covers: dto.covers,
          customerNote: dto.customerNote,
        },
      });
      if (tableId) {
        const change = await this.floor.occupy(tx, tableId, created.id);
        if (change) pending.push(evt('table.status.changed', { restaurantId: s.restaurantId, ...change }));
      }
      if (dto.items?.length) {
        await this.insertLines(tx, created.id, await this.menu.getPricedItems(tx, dto.items), dto.items);
        await this.pricing.recalc(tx, created.id);
      }
      pending.push(evt('order.created', { restaurantId: s.restaurantId, orderId: created.id, number, tableId, type: dto.type }));
      return this.query.load(tx, created.id);
    });
    this.events.emitAll(pending);
    return this.query.respond(order);
  }

  async addItems(s: RequestSession, orderId: string, items: AddItemDto[]) {
    const order = await this.db.run(async (tx) => {
      const locked = await this.getForUpdate(tx, orderId, s);
      this.assertEditable(locked.status);
      await this.insertLines(tx, orderId, await this.menu.getPricedItems(tx, items), items);
      await this.pricing.recalc(tx, orderId);
      return this.query.load(tx, orderId);
    });
    this.events.emit('order.items.changed', { restaurantId: s.restaurantId, orderId });
    return this.query.respond(order);
  }

  /** Only unsent items can be edited; sent items must be voided (with approval) instead. */
  async updateItem(s: RequestSession, orderId: string, itemId: string, dto: UpdateItemDto) {
    const order = await this.db.run(async (tx) => {
      const locked = await this.getForUpdate(tx, orderId, s);
      this.assertEditable(locked.status);
      const item = this.unsentItem(locked, itemId);
      const unitWithMods = item.lineTotalMinor / item.qty;
      await tx.orderItem.update({
        where: { id: itemId },
        data: { qty: dto.qty, notes: dto.notes, ...(dto.qty ? { lineTotalMinor: unitWithMods * dto.qty } : {}) },
      });
      await this.pricing.recalc(tx, orderId);
      return this.query.load(tx, orderId);
    });
    this.events.emit('order.items.changed', { restaurantId: s.restaurantId, orderId });
    return this.query.respond(order);
  }

  async removeItem(s: RequestSession, orderId: string, itemId: string) {
    const order = await this.db.run(async (tx) => {
      const locked = await this.getForUpdate(tx, orderId, s);
      this.assertEditable(locked.status);
      this.unsentItem(locked, itemId);
      await tx.orderItem.delete({ where: { id: itemId } });
      await this.pricing.recalc(tx, orderId);
      return this.query.load(tx, orderId);
    });
    this.events.emit('order.items.changed', { restaurantId: s.restaurantId, orderId });
    return this.query.respond(order);
  }

  /** Cancel an order nothing was sent for (no approval needed). Sent orders must be voided. */
  async cancel(s: RequestSession, orderId: string, reason?: string) {
    const pending: PendingEvent[] = [];
    const order = await this.db.run(async (tx) => {
      const locked = await this.getForUpdate(tx, orderId, s);
      if (locked.status !== OrderStatus.OPEN || locked.items.some((i) => i.ticketId)) {
        throw new InvalidStateException('Only unsent orders can be cancelled; void it instead');
      }
      await this.fsm.transition(tx, orderId, locked.status, OrderStatus.CANCELLED, { closedAt: new Date(), voidReason: reason ?? null });
      if (locked.tableId) {
        const change = await this.floor.release(tx, locked.tableId, orderId);
        if (change) pending.push(evt('table.status.changed', { restaurantId: s.restaurantId, ...change }));
      }
      await this.audit.record(tx, { action: 'order.cancel', subjectType: 'order', subjectId: orderId, after: { reason: reason ?? null } });
      pending.push(evt('order.closed', { restaurantId: s.restaurantId, orderId, status: OrderStatus.CANCELLED }));
      return this.query.load(tx, orderId);
    });
    this.events.emitAll(pending);
    return this.query.respond(order);
  }

  // ── Primitives for order-flow (caller owns the transaction) ─────────────

  /** SELECT … FOR UPDATE, then full load. Serialises concurrent writers on the same order. */
  async getForUpdate(tx: TenantTx, orderId: string, s?: RequestSession) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    if (!locked.length) throw new EntityNotFoundException('Order', orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(s ? this.query.visibilityFilter(s) : {}) },
      include: { items: true, tickets: true, table: { select: { id: true, label: true } } },
    });
    if (!order) throw new EntityNotFoundException('Order', orderId);
    return order;
  }

  /** Links fired items to their tickets and stamps sentAt (first send only). */
  async markSent(tx: TenantTx, order: LockedOrder, fired: { ticketId: string; itemIds: string[] }[]) {
    for (const t of fired) {
      await tx.orderItem.updateMany({ where: { id: { in: t.itemIds }, ticketId: null }, data: { ticketId: t.ticketId, status: ItemStatus.PENDING } });
    }
    if (!order.sentAt) await tx.order.update({ where: { id: order.id }, data: { sentAt: new Date() } });
  }

  private assertEditable(status: OrderStatus) {
    if (!EDITABLE_ORDER_STATUSES.includes(status)) throw new InvalidStateException(`Order is ${status}; items can no longer be changed`);
  }

  private unsentItem(order: LockedOrder, itemId: string) {
    const item = order.items.find((i) => i.id === itemId);
    if (!item || item.voidedAt) throw new EntityNotFoundException('Order item', itemId);
    if (item.ticketId) throw new DomainException('Item already sent to the kitchen; void it instead', 'ITEM_ALREADY_SENT');
    return item;
  }

  private async insertLines(tx: TenantTx, orderId: string, priced: PricedLine[], requested: AddItemDto[]) {
    const restaurantId = rid();
    for (const [i, line] of priced.entries()) {
      await tx.orderItem.create({
        data: {
          restaurantId,
          orderId,
          menuItemId: line.menuItemId,
          nameSnapshot: line.name,
          unitPriceMinor: line.unitPriceMinor,
          qty: line.qty,
          lineTotalMinor: line.lineTotalMinor,
          notes: requested[i]?.notes,
          modifiers: {
            create: line.modifiers.map((m) => ({ restaurantId, modifierId: m.modifierId, nameSnapshot: m.name, priceDeltaMinor: m.priceDeltaMinor })),
          },
        },
      });
    }
  }
}
