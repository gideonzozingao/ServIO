import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { RoomService, rooms } from '../room.service.js';

@Injectable()
export class OrderListener {
  constructor(private readonly rooms$: RoomService) {}

  @OnEvent('order.created')
  created(e: DomainEventMap['order.created']) {
    this.rooms$.emit(rooms.admin(e.restaurantId), 
    'order.created',
    { orderId: e.orderId, number: e.number, tableId: e.tableId, type: e.type });
  }

  @OnEvent('order.status.changed')
  status(e: DomainEventMap['order.status.changed']) {
    this.rooms$.emit([rooms.waiters(e.restaurantId), rooms.admin(e.restaurantId)], 
    'order.status.changed',
     { orderId: e.orderId, from: e.from, to: e.to });
  }

  @OnEvent('order.items.changed')
  items(e: DomainEventMap['order.items.changed']) {
    this.rooms$.emit(rooms.waiters(e.restaurantId),
    'order.items.changed', 
    { orderId: e.orderId });
  }

  @OnEvent('order.closed')
  closed(e: DomainEventMap['order.closed']) {
    this.rooms$.emit([rooms.waiters(e.restaurantId), rooms.admin(e.restaurantId)], 
    'order.closed',
     { orderId: e.orderId, status: e.status });
  }

  @OnEvent('bill.created')
  bill(e: DomainEventMap['bill.created']) {
    this.rooms$.emit([rooms.waiters(e.restaurantId), rooms.admin(e.restaurantId)], 
    'bill.created', 
     { billId: e.billId, orderId: e.orderId, totalMinor: e.totalMinor });
  }

  @OnEvent('payment.recorded')
  payment(e: DomainEventMap['payment.recorded']) {
    this.rooms$.emit(rooms.admin(e.restaurantId),
    'payment.recorded',
     { billId: e.billId, paymentId: e.paymentId, method: e.method, amountMinor: e.amountMinor });
  }
}
