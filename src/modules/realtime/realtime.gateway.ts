import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { StaffRole } from '../../common/types/tx.type.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { BETTER_AUTH, type AuthInstance } from '../auth/auth.config.js';
import { MemberRoleService } from '../auth/member-role.service.js';
import {
  autoRooms,
  RoomService,
  rooms,
  STATION_ROLES,
} from './room.service.js';

interface SocketData {
  userId: string;
  restaurantId: string;
  role: StaffRole;
  deviceId: string | null;
}

const origins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * /rt namespace. Auth: Better Auth session from cookie (web) or `auth.token` (Expo bearer).
 * Payloads are ids + display fields only; clients refetch details over REST (the API is the source of truth).
 */
@WebSocketGateway({
  namespace: '/rt',
  cors: { origin: origins.length ? origins : true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    @Inject(BETTER_AUTH) private readonly auth: AuthInstance,
    private readonly members: MemberRoleService,
    private readonly roomsSvc: RoomService,
    private readonly db: TenantPrismaService,
  ) {}

  afterInit(server: Server) {
    this.roomsSvc.bind(server);
  }

  async handleConnection(socket: Socket) {
    try {
      const headers = new Headers();
      if (socket.handshake.headers.cookie)
        headers.set('cookie', socket.handshake.headers.cookie);
      const token = socket.handshake.auth?.token;
      if (typeof token === 'string' && token)
        headers.set('authorization', `Bearer ${token}`);

      const result = await this.auth.api.getSession({ headers });
      const session = result?.session as
        | (NonNullable<typeof result>['session'] & {
            activeOrganizationId?: string | null;
            deviceId?: string | null;
          })
        | undefined;
      const restaurantId = session?.activeOrganizationId;
      if (!result || !restaurantId) return socket.disconnect(true);

      const role = await this.members.roleOf(restaurantId, result.user.id);
      if (!role) return socket.disconnect(true);

      const data: SocketData = {
        userId: result.user.id,
        restaurantId,
        role,
        deviceId: session?.deviceId ?? null,
      };
      socket.data = data;
      await socket.join(
        autoRooms(restaurantId, data.userId, role, data.deviceId),
      );
      socket.emit('ready', { restaurantId, role });
    } catch (e) {
      this.logger.warn(`socket auth failed: ${(e as Error).message}`);
      socket.disconnect(true);
    }
  }

  /** KDS subscribes to its station after connecting. Validated against role and tenant. */
  @SubscribeMessage('station.join')
  async joinStation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { stationId?: string },
  ) {
    const data = socket.data as SocketData;
    if (!data?.restaurantId || !STATION_ROLES.includes(data.role))
      throw new WsException('Forbidden');
    const stationId = body?.stationId;
    if (typeof stationId !== 'string')
      throw new WsException('stationId required');

    const exists = await this.db.runFor(data.restaurantId, (tx) =>
      tx.station.count({ where: { id: stationId, active: true } }),
    );
    if (!exists) throw new WsException('Unknown station');
    await socket.join(rooms.station(data.restaurantId, stationId));
    return { ok: true, stationId };
  }

  @SubscribeMessage('station.leave')
  async leaveStation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { stationId?: string },
  ) {
    const data = socket.data as SocketData;
    if (data?.restaurantId && typeof body?.stationId === 'string')
      await socket.leave(rooms.station(data.restaurantId, body.stationId));
    return { ok: true };
  }
}
