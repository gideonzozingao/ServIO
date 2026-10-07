import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { RoomService, rooms } from '../room.service.js';

@Injectable()
export class TableListener {
  constructor(private readonly rooms$: RoomService) {}

  @OnEvent('table.status.changed')
  changed(e: DomainEventMap['table.status.changed']) {
    this.rooms$.emit(rooms.waiters(e.restaurantId), 'table.status.changed', { tableId: e.tableId, status: e.status });
  }
}
