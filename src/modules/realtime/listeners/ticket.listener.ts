import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { RoomService, rooms } from '../room.service.js';

@Injectable()
export class TicketListener {
  constructor(private readonly rooms$: RoomService) {}

  @OnEvent('ticket.created')
  created(e: DomainEventMap['ticket.created']) {
    const p = {
      ticketId: e.ticketId,
      orderId: e.orderId,
      stationId: e.stationId,
      round: e.round,
    };
    this.rooms$.emit(
      [
        rooms.station(e.restaurantId, e.stationId),
        rooms.kitchen(e.restaurantId),
      ],
      'ticket.created',
      p,
    );
  }

  @OnEvent('ticket.updated')
  updated(e: DomainEventMap['ticket.updated']) {
    const p = {
      ticketId: e.ticketId,
      orderId: e.orderId,
      stationId: e.stationId,
      status: e.status,
    };
    this.rooms$.emit(
      [
        rooms.station(e.restaurantId, e.stationId),
        rooms.kitchen(e.restaurantId),
        rooms.waiters(e.restaurantId),
      ],
      'ticket.updated',
      p,
    );
  }

  @OnEvent('ticket.ready')
  ready(e: DomainEventMap['ticket.ready']) {
    this.rooms$.emit(rooms.waiters(e.restaurantId), 'ticket.ready', {
      ticketId: e.ticketId,
      orderId: e.orderId,
      orderNumber: e.orderNumber,
      tableLabel: e.tableLabel,
      waiterId: e.waiterId,
    });
  }
}
