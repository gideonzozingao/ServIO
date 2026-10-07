import { DailyFigures } from './types/reporting.types.js';
import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../common/types/tx.type.js';
import { isoToDbDate } from '../../common/utils/business-date.util.js';
import { rid } from '../../database/tenant-scope.js';

/** Idempotent per (restaurant, business date). Raw SQL is tagged (parameterised) and still under RLS. */
@Injectable()
export class DailyRollupService {
  async compute(tx: TenantTx, iso: string): Promise<DailyFigures> {
    const r = rid();
    const [sales] = await tx.$queryRaw<
      {
        orders: number;
        gross: bigint;
        discount: bigint;
        tax: bigint;
        total: bigint;
      }[]
    >`
      SELECT count(*)::int AS orders,
             coalesce(sum(subtotal_minor), 0)::bigint AS gross,
             coalesce(sum(discount_minor), 0)::bigint AS discount,
             coalesce(sum(tax_minor), 0)::bigint      AS tax,
             coalesce(sum(total_minor), 0)::bigint    AS total
        FROM orders
       WHERE restaurant_id = ${r} AND business_date = ${iso}::date AND status = 'PAID'`;

    const [voids] = await tx.$queryRaw<{ cnt: number; amt: bigint }[]>`
      SELECT count(*)::int AS cnt, coalesce(sum(oi.line_total_minor), 0)::bigint AS amt
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.restaurant_id = ${r} AND o.business_date = ${iso}::date AND oi.voided_at IS NOT NULL`;

    const methods = await tx.$queryRaw<{ method: string; amount: bigint }[]>`
      SELECT p.method::text AS method, sum(p.amount_minor)::bigint AS amount
        FROM payments p JOIN bills b ON b.id = p.bill_id
       WHERE p.restaurant_id = ${r} AND b.business_date = ${iso}::date AND b.status <> 'VOID'
       GROUP BY p.method`;

    const total = Number(sales.total);
    const tax = Number(sales.tax);
    return {
      businessDate: iso,
      ordersCount: sales.orders,
      grossMinor: Number(sales.gross),
      discountMinor: Number(sales.discount),
      taxMinor: tax,
      netMinor: total - tax,
      totalMinor: total,
      voidsCount: voids.cnt,
      voidsMinor: Number(voids.amt),
      byMethod: Object.fromEntries(
        methods.map((m) => [m.method, Number(m.amount)]),
      ),
    };
  }

  async persist(tx: TenantTx, iso: string): Promise<DailyFigures> {
    const f = await this.compute(tx, iso);
    const data = {
      ordersCount: f.ordersCount,
      grossMinor: f.grossMinor,
      taxMinor: f.taxMinor,
      discountMinor: f.discountMinor,
      netMinor: f.netMinor,
      voidsCount: f.voidsCount,
      voidsMinor: f.voidsMinor,
      byMethod: f.byMethod,
      computedAt: new Date(),
    };
    await tx.dailySalesSummary.upsert({
      where: {
        restaurantId_businessDate: {
          restaurantId: rid(),
          businessDate: isoToDbDate(iso),
        },
      },
      create: { restaurantId: rid(), businessDate: isoToDbDate(iso), ...data },
      update: data,
    });
    return f;
  }
}
