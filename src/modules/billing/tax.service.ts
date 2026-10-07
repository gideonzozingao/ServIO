import { Injectable } from '@nestjs/common';
import { computeTotals, type Totals } from '../../common/money/tax.util.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { RestaurantSettingsService } from '../settings/restaurant-settings.service.js';

@Injectable()
export class TaxService {
  constructor(private readonly settings: RestaurantSettingsService) {}

  async totals(tx: TenantTx, subtotalMinor: number, discountMinor: number): Promise<Totals> {
    return computeTotals(subtotalMinor, discountMinor, await this.settings.get(tx));
  }
}
