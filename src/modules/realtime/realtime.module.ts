import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../../jobs/queues.js';
import { MenuListener } from './listeners/menu.listener.js';
import { OrderListener } from './listeners/order.listener.js';
import { PushListener } from './listeners/push.listener.js';
import { SessionRevokedListener } from './listeners/session-revoked.listener.js';
import { TableListener } from './listeners/table.listener.js';
import { TicketListener } from './listeners/ticket.listener.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RoomService } from './room.service.js';

/** Imports no domain modules: it only reacts to domain events. */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.notifications })],
  providers: [RealtimeGateway, RoomService, TicketListener, TableListener, MenuListener, OrderListener, SessionRevokedListener, PushListener],
})
export class RealtimeModule {}
