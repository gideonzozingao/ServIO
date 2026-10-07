import { Injectable } from '@nestjs/common';
import { DomainConflictException, DomainException, EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { TableStatus } from '../../database/prisma-client.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { DomainEvents } from '../../infrastructure/events/domain-events.service.js';
import { OPEN_ORDER_STATUSES } from '../../common/types/order-status.js';
import type { CreateTableDto, SetTableStatusDto, UpdateTableDto } from './dto/floor.dto.js';

export interface TableChange {
  tableId: string;
  status: TableStatus;
}

@Injectable()
export class FloorService {
  constructor(private readonly db: TenantPrismaService, private readonly events: DomainEvents) {}

  /** Floor plan with the current open order per table. */
  list(includeInactive = false) {
    return this.db.run(async (tx) => {
      const tables = await tx.diningTable.findMany({
        where: includeInactive ? {} : { active: true },
        orderBy: [{ section: 'asc' }, { label: 'asc' }],
        include: {
          orders: {
            where: { status: { in: OPEN_ORDER_STATUSES } },
            select: { id: true, number: true, status: true, waiterId: true, covers: true, totalMinor: true, openedAt: true },
            orderBy: { openedAt: 'desc' },
            take: 1,
          },
        },
      });
      return tables.map(({ orders, ...t }) => ({ ...t, currentOrder: orders[0] ?? null }));
    });
  }

  create(dto: CreateTableDto) {
    return this.db.run((tx) => tx.diningTable.create({ data: { restaurantId: rid(), label: dto.label, section: dto.section, seats: dto.seats ?? 2 } }));
  }

  update(id: string, dto: UpdateTableDto) {
    return this.db.run(async (tx) => {
      if (dto.active === false && (await this.openOrderCount(tx, id))) throw new DomainException('Table has an open order', 'TABLE_BUSY');
      if (!(await tx.diningTable.updateMany({ where: { id }, data: dto })).count) throw new EntityNotFoundException('Table', id);
      return tx.diningTable.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Manual status (e.g. RESERVED). Cannot free a table that still has an open order. */
  async setStatus(id: string, dto: SetTableStatusDto) {
    const restaurantId = this.db.restaurantId;
    const table = await this.db.run(async (tx) => {
      if (dto.status === TableStatus.FREE && (await this.openOrderCount(tx, id))) throw new DomainException('Table has an open order', 'TABLE_BUSY');
      if (!(await tx.diningTable.updateMany({ where: { id }, data: { status: dto.status } })).count) throw new EntityNotFoundException('Table', id);
      return tx.diningTable.findUniqueOrThrow({ where: { id } });
    });
    this.events.emit('table.status.changed', { restaurantId, tableId: id, status: table.status });
    return table;
  }

  // ── Called by orders / order-flow inside their transaction ──────────────

  /** One open dine-in order per table. Idempotent for the same order. Returns a change to emit after commit. */
  async occupy(tx: TenantTx, tableId: string, orderId: string): Promise<TableChange | null> {
    const rows = await tx.$queryRaw<{ id: string; status: TableStatus; active: boolean }[]>`
      SELECT id, status::text AS status, active FROM tables WHERE id = ${tableId} FOR UPDATE`;
    const table = rows[0];
    if (!table || !table.active) throw new DomainException('Unknown or inactive table', 'TABLE_NOT_FOUND');

    const other = await tx.order.count({ where: { tableId, id: { not: orderId }, status: { in: OPEN_ORDER_STATUSES } } });
    if (other) throw new DomainConflictException('Table already has an open order', 'TABLE_OCCUPIED');

    if (table.status === TableStatus.OCCUPIED) return null;
    await tx.diningTable.update({ where: { id: tableId }, data: { status: TableStatus.OCCUPIED } });
    return { tableId, status: TableStatus.OCCUPIED };
  }

  /** Frees the table if no other open order remains on it. */
  async release(tx: TenantTx, tableId: string, closingOrderId: string): Promise<TableChange | null> {
    const others = await tx.order.count({ where: { tableId, id: { not: closingOrderId }, status: { in: OPEN_ORDER_STATUSES } } });
    if (others) return null;
    const n = await tx.diningTable.updateMany({ where: { id: tableId, status: { not: TableStatus.FREE } }, data: { status: TableStatus.FREE } });
    return n.count ? { tableId, status: TableStatus.FREE } : null;
  }

  private openOrderCount(tx: TenantTx, tableId: string) {
    return tx.order.count({ where: { tableId, status: { in: OPEN_ORDER_STATUSES } } });
  }
}
