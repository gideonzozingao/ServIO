import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { RoomService, rooms } from '../room.service.js';

/** Revoking a device or deactivating staff drops their live sockets immediately. */
@Injectable()
export class SessionRevokedListener {
  constructor(private readonly rooms$: RoomService) {}

  @OnEvent('device.revoked')
  device(e: DomainEventMap['device.revoked']) {
    this.rooms$.disconnect(rooms.device(e.restaurantId, e.deviceId));
  }

  @OnEvent('staff.deactivated')
  staff(e: DomainEventMap['staff.deactivated']) {
    this.rooms$.disconnect(rooms.user(e.restaurantId, e.userId));
  }
}
