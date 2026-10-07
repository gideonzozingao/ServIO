import { DailyFigures } from './types/reporting.types.js';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/exceptions/domain.exceptions.js';
import { isoToDbDate } from '../../common/utils/business-date.util.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { RestaurantSettingsService } from '../settings/restaurant-settings.service.js';
import { StaffDirectoryService } from '../staff/staff-directory.service.js';
import { DailyRollupService } from './daily-rollup.service.js';

const MAX_RANGE_DAYS = 92;
export const reportCachePrefix = (restaurantId: string) =>
  `report:${restaurantId}:`;

@Injectable()
export class ReportQueryService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly redis: RedisService,
    private readonly settings: RestaurantSettingsService,
    private readonly rollup: DailyRollupService,
    private readonly directory: StaffDirectoryService,
  ) {}

  /** Past days come from the nightly summary when present; today (or a missing day) is computed live. */
  async daily(date?: string) {
    const today = (await this.settings.businessDate()).iso;
    const iso = date ?? today;
    return this.cached(`daily:${iso}`, iso >= today, async () => {
      const figures = await this.db.run(async (tx) => {
        if (iso < today) {
          const s = await tx.dailySalesSummary.findFirst({
            where: { businessDate: isoToDbDate(iso) },
          });
          if (s) {
            return {
              source: 'summary' as const,
              businessDate: iso,
              ordersCount: s.ordersCount,
              grossMinor: s.grossMinor,
              discountMinor: s.discountMinor,
              taxMinor: s.taxMinor,
              netMinor: s.netMinor,
              totalMinor: s.netMinor + s.taxMinor,
              voidsCount: s.voidsCount,
              voidsMinor: s.voidsMinor,
              byMethod: s.byMethod as Record<string, number>,
            } satisfies DailyFigures & { source: string };
          }
        }
        return {
          source: 'live' as const,
          ...(await this.rollup.compute(tx, iso)),
        };
      });
      return {
        ...figures,
        averageOrderMinor: figures.ordersCount
          ? Math.round(figures.totalMinor / figures.ordersCount)
          : 0,
      };
    });
  }

  async topItems(from: string, to: string, limit: number) {
    this.assertRange(from, to);
    return this.cached(
      `top:${from}:${to}:${limit}`,
      await this.includesToday(to),
      () =>
        this.db.run(async (tx) => {
          const rows = await tx.$queryRaw<
            { menuItemId: string; name: string; qty: number; revenue: bigint }[]
          >`
          SELECT oi.menu_item_id AS "menuItemId", oi.name_snapshot AS name,
                 sum(oi.qty)::int AS qty, sum(oi.line_total_minor)::bigint AS revenue
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.restaurant_id = ${rid()} AND o.business_date BETWEEN ${from}::date AND ${to}::date
             AND o.status = 'PAID' AND oi.voided_at IS NULL
           GROUP BY 1, 2
           ORDER BY revenue DESC
           LIMIT ${limit}`;
          return rows.map((r) => ({
            menuItemId: r.menuItemId,
            name: r.name,
            qty: r.qty,
            revenueMinor: Number(r.revenue),
          }));
        }),
    );
  }

  async staff(from: string, to: string) {
    this.assertRange(from, to);
    return this.cached(
      `staff:${from}:${to}`,
      await this.includesToday(to),
      async () => {
        const rows = await this.db.run(
          (tx) =>
            tx.$queryRaw<
              {
                waiterId: string;
                orders: number;
                sales: bigint;
                covers: number;
              }[]
            >`
          SELECT waiter_id AS "waiterId", count(*)::int AS orders,
                 coalesce(sum(total_minor), 0)::bigint AS sales, coalesce(sum(covers), 0)::int AS covers
            FROM orders
           WHERE restaurant_id = ${rid()} AND business_date BETWEEN ${from}::date AND ${to}::date AND status = 'PAID'
           GROUP BY waiter_id
           ORDER BY sales DESC`,
        );
        const names = await this.directory.namesByIds(
          rows.map((r) => r.waiterId),
        );
        return rows.map((r) => ({
          waiterId: r.waiterId,
          name: names.get(r.waiterId) ?? null,
          orders: r.orders,
          covers: r.covers,
          salesMinor: Number(r.sales),
          averageOrderMinor: r.orders
            ? Math.round(Number(r.sales) / r.orders)
            : 0,
        }));
      },
    );
  }

  /** Voids and discounts with actor + approver, from the audit log (local business-day window). */
  async voids(from: string, to: string) {
    this.assertRange(from, to);
    const s = await this.settings.get();
    return this.cached(
      `voids:${from}:${to}`,
      await this.includesToday(to),
      async () => {
        const rows = await this.db.run(
          (tx) =>
            tx.$queryRaw<
              {
                id: string;
                action: string;
                subjectId: string | null;
                userId: string | null;
                approverId: string | null;
                before: unknown;
                after: unknown;
                createdAt: Date;
              }[]
            >`
          SELECT id, action, subject_id AS "subjectId", user_id AS "userId", approver_id AS "approverId",
                 before, after, created_at AS "createdAt"
            FROM audit_logs
           WHERE restaurant_id = ${rid()}
             AND action IN ('order.void', 'item.void', 'bill.discount')
             AND created_at >= ((${from}::date)::timestamp + ${s.dayRolloverHour} * interval '1 hour') AT TIME ZONE ${s.timezone}
             AND created_at <  ((${to}::date + 1)::timestamp + ${s.dayRolloverHour} * interval '1 hour') AT TIME ZONE ${s.timezone}
           ORDER BY created_at DESC
           LIMIT 1000`,
        );
        const names = await this.directory.namesByIds(
          rows.flatMap((r) => [r.userId, r.approverId]),
        );
        return rows.map((r) => ({
          ...r,
          user: names.get(r.userId ?? '') ?? null,
          approver: names.get(r.approverId ?? '') ?? null,
        }));
      },
    );
  }

  private assertRange(from: string, to: string) {
    if (from > to)
      throw new DomainException(
        '`from` must be on or before `to`',
        'INVALID_RANGE',
      );
    const days =
      (isoToDbDate(to).getTime() - isoToDbDate(from).getTime()) / 86_400_000;
    if (days > MAX_RANGE_DAYS)
      throw new DomainException(
        `Range limited to ${MAX_RANGE_DAYS} days`,
        'RANGE_TOO_LARGE',
      );
  }

  private async includesToday(to: string) {
    return to >= (await this.settings.businessDate()).iso;
  }

  private async cached<T>(
    name: string,
    live: boolean,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${reportCachePrefix(this.db.restaurantId)}${name}`;
    const hit = await this.redis.getJson<T>(key);
    if (hit) return hit;
    const value = await fn();
    await this.redis.setJson(key, value, live ? 60 : 86_400);
    return value;
  }
}
