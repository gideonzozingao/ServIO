import { Injectable } from '@nestjs/common';
import { paginate } from '../../common/dto/paginated-response.dto.js';
import { cursorArgs } from '../../common/dto/pagination.dto.js';
import { EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import type { RequestSession, TenantTx } from '../../common/types/tx.type.js';
import { isoToDbDate } from '../../common/utils/business-date.util.js';
import type { Prisma } from '../../database/prisma-client.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { StaffDirectoryService } from '../staff/staff-directory.service.js';
import type { OrderListQueryDto } from './dto/order-query.dto.js';
import { ORDER_DETAIL_INCLUDE, toOrderResponse } from './dto/order-response.dto.js';
import { OPEN_ORDER_STATUSES, TERMINAL_ORDER_STATUSES } from './order-state-machine.js';

/**
 * Visibility policy (open point in the design): waiters see only their own orders;
 * owner/manager/cashier see all. Flip WAITERS_SEE_ALL to share tables between waiters.
 */
const WAITERS_SEE_ALL = false;

@Injectable()
export class OrderQueryService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly directory: StaffDirectoryService,
  ) {}

  visibilityFilter(s: RequestSession): Prisma.OrderWhereInput {
    return s.role === 'waiter' && !WAITERS_SEE_ALL ? { waiterId: s.userId } : {};
  }

  async list(s: RequestSession, q: OrderListQueryDto) {
    const status =
      q.status === 'open' ? { in: OPEN_ORDER_STATUSES }
      : q.status === 'closed' ? { in: TERMINAL_ORDER_STATUSES }
      : q.status;
    const rows = await this.db.run((tx) =>
      tx.order.findMany({
        where: {
          ...this.visibilityFilter(s),
          status,
          tableId: q.tableId,
          ...(q.waiterId ? { waiterId: q.waiterId } : {}),
          businessDate: q.businessDate ? isoToDbDate(q.businessDate) : undefined,
        },
        include: { table: { select: { id: true, label: true } }, _count: { select: { items: { where: { voidedAt: null } } } } },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q),
      }),
    );
    const page = paginate(rows, q.limit);
    const names = await this.directory.namesByIds(page.items.map((o) => o.waiterId));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((o) => ({
        id: o.id, number: o.number, type: o.type, status: o.status, table: o.table,
        waiter: { id: o.waiterId, name: names.get(o.waiterId) ?? null },
        itemCount: o._count.items, totalMinor: o.totalMinor, openedAt: o.openedAt,
      })),
    };
  }

  async get(s: RequestSession, id: string) {
    const order = await this.db.run((tx) => this.load(tx, id, s));
    return toOrderResponse(order, await this.directory.namesByIds([order.waiterId]));
  }

  /** Loads full detail inside an existing transaction (use cases return fresh state). */
  async load(tx: TenantTx, id: string, s?: RequestSession) {
    const order = await tx.order.findFirst({ where: { id, ...(s ? this.visibilityFilter(s) : {}) }, include: ORDER_DETAIL_INCLUDE });
    if (!order) throw new EntityNotFoundException('Order', id);
    return order;
  }

  async respond(order: Awaited<ReturnType<OrderQueryService['load']>>) {
    return toOrderResponse(order, await this.directory.namesByIds([order.waiterId]));
  }
}
