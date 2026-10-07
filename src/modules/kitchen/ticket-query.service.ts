import { Injectable } from '@nestjs/common';
import { EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import { TicketStatus, type Prisma } from '../../database/prisma-client.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import type { TicketBoardQueryDto } from './dto/ticket.dto.js';

const BOARD_INCLUDE = {
  station: { select: { id: true, name: true } },
  order: {
    select: {
      id: true,
      number: true,
      type: true,
      customerNote: true,
      covers: true,
      table: { select: { label: true } },
    },
  },
  items: {
    where: { voidedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      nameSnapshot: true,
      qty: true,
      notes: true,
      status: true,
      modifiers: { select: { nameSnapshot: true } },
    },
  },
} satisfies Prisma.KitchenTicketInclude;

type BoardTicket = Prisma.KitchenTicketGetPayload<{
  include: typeof BOARD_INCLUDE;
}>;

const toCard = (t: BoardTicket) => ({
  id: t.id,
  status: t.status,
  round: t.round,
  station: t.station,
  firedAt: t.firedAt,
  startedAt: t.startedAt,
  readyAt: t.readyAt,
  order: {
    id: t.order.id,
    number: t.order.number,
    type: t.order.type,
    table: t.order.table?.label ?? null,
    covers: t.order.covers,
    note: t.order.customerNote,
  },
  items: t.items.map((i) => ({
    id: i.id,
    name: i.nameSnapshot,
    qty: i.qty,
    notes: i.notes,
    status: i.status,
    modifiers: i.modifiers.map((m) => m.nameSnapshot),
  })),
});

@Injectable()
export class TicketQueryService {
  constructor(private readonly db: TenantPrismaService) {}

  /** KDS board: oldest first. Polling fallback and reconnect refetch use this. */
  async board(q: TicketBoardQueryDto) {
    const rows = await this.db.run((tx) =>
      tx.kitchenTicket.findMany({
        where: {
          stationId: q.station,
          status: {
            in: q.status?.length
              ? q.status
              : [TicketStatus.NEW, TicketStatus.PREPARING, TicketStatus.READY],
          },
        },
        include: BOARD_INCLUDE,
        orderBy: [{ firedAt: 'asc' }, { id: 'asc' }],
        take: 200,
      }),
    );
    return rows.map(toCard);
  }

  async get(id: string) {
    const t = await this.db.run((tx) =>
      tx.kitchenTicket.findFirst({ where: { id }, include: BOARD_INCLUDE }),
    );
    if (!t) throw new EntityNotFoundException('Kitchen ticket', id);
    return toCard(t);
  }
}
