
import { mulDivRound } from './money.js';

export interface TaxRule {
  taxRateBps: number;        // 1000 = 10.00%
  pricesIncludeTax: boolean; // GST-inclusive menu prices
}

export interface Totals {
  subtotalMinor: number; // sum of non-voided line totals as priced on the menu
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;    // amount the customer pays
}

/**
 * Inclusive: menu prices already contain GST; tax is the GST portion of (subtotal - discount).
 * Exclusive: GST is added on top of (subtotal - discount).
 */
export function computeTotals(subtotalMinor: number, discountMinor: number, rule: TaxRule): Totals {
  const discount = Math.min(Math.max(discountMinor, 0), subtotalMinor);
  const base = subtotalMinor - discount;
  if (rule.pricesIncludeTax) {
    const tax = mulDivRound(base, rule.taxRateBps, 10_000 + rule.taxRateBps);
    return { subtotalMinor, discountMinor: discount, taxMinor: tax, totalMinor: base };
  }
  const tax = mulDivRound(base, rule.taxRateBps, 10_000);
  return { subtotalMinor, discountMinor: discount, taxMinor: tax, totalMinor: base + tax };
}

export function percentOf(amountMinor: number, bps: number): number {
  return mulDivRound(amountMinor, bps, 10_000);
}
