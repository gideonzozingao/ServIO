import { Injectable } from '@nestjs/common';
import { computeTotals, type Totals } from '../../common/money/tax.util.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { RestaurantSettingsService } from '../settings/restaurant-settings.service.js';

/** Order totals are ALWAYS computed here from snapshotted line totals. Clients never send money. */
@Injectable()
export class OrderPricingService {
  constructor(private readonly settings: RestaurantSettingsService) {}

  async recalc(tx: TenantTx, orderId: string): Promise<Totals> {
    // Sequential on purpose: one transaction = one connection; never run queries on it concurrently.
    const agg = await tx.orderItem.aggregate({
      where: { orderId, voidedAt: null },
      _sum: { lineTotalMinor: true },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { discountMinor: true },
    });
    const rule = await this.settings.get(tx);
    const totals = computeTotals(
      agg._sum.lineTotalMinor ?? 0,
      order.discountMinor,
      rule,
    );
    await tx.order.update({ where: { id: orderId }, data: totals });
    return totals;
  }
}
