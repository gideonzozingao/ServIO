import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { StaffRole } from '../../common/types/tx.type.js';

export const rooms = {
  all: (r: string) => `r:${r}:all`,
  waiters: (r: string) => `r:${r}:waiters`,
  admin: (r: string) => `r:${r}:admin`,
  station: (r: string, stationId: string) => `r:${r}:station:${stationId}`,
  kitchen: (r: string) => `r:${r}:kitchen`, // every station (expo / head chef screens)
  user: (r: string, userId: string) => `r:${r}:user:${userId}`,
  device: (r: string, deviceId: string) => `r:${r}:device:${deviceId}`,
};

/** Rooms a member joins automatically on connect. Station rooms are joined on request. */
export function autoRooms(restaurantId: string, userId: string, role: StaffRole, deviceId: string | null): string[] {
  const list = [rooms.all(restaurantId), rooms.user(restaurantId, userId)];
  if (deviceId) list.push(rooms.device(restaurantId, deviceId));
  if (role !== 'kitchen') list.push(rooms.waiters(restaurantId));
  if (role === 'owner' || role === 'manager') list.push(rooms.admin(restaurantId), rooms.kitchen(restaurantId));
  // Kitchen devices receive only the stations they explicitly join (station.join).
  return list;
}

export const STATION_ROLES: StaffRole[] = ['kitchen', 'manager', 'owner'];

@Injectable()
export class RoomService {
  private server?: Server;

  bind(server: Server) {
    this.server = server;
  }

  emit(room: string | string[], event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  disconnect(room: string) {
    this.server?.in(room).disconnectSockets(true);
  }
}
