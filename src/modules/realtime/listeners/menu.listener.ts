import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { RoomService, rooms } from '../room.service.js';

@Injectable()
export class MenuListener {
  constructor(private readonly rooms$: RoomService) {}

  @OnEvent('menu.item.availability.changed')
  availability(e: DomainEventMap['menu.item.availability.changed']) {
    this.rooms$.emit(
      rooms.all(e.restaurantId),
      'menu.item.availability.changed',
      { menuItemId: e.menuItemId, available: e.available },
    );
  }

  /** Clients refetch GET /menu (ETag makes it cheap). */
  @OnEvent('menu.updated')
  updated(e: DomainEventMap['menu.updated']) {
    this.rooms$.emit(rooms.all(e.restaurantId), 'menu.updated', {});
  }
}
