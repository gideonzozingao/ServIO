/**
 * Servio financial utilities (src/common/money/money.util.ts)
 *
 * Rules
 *  - Money is ALWAYS an integer count of minor units (toea for PGK). Never floats.
 *  - Rounding is integer-only, half away from zero ("half up" for positives).
 *  - Rates are basis points (bps): 1000 = 10.00%.
 *  - Order of operations for totals:
 *      subtotal  = sum of non-voided line totals
 *      discount  = applied to the subtotal (capped at the subtotal)
 *      tax       = computed on the discounted amount
 *      inclusive prices: total = subtotal - discount (tax is carved out of it)
 *      exclusive prices: total = subtotal - discount + tax
 *  - Everything here is pure and side-effect free; call it inside use cases,
 *    never trust totals sent by clients.
 *
 * Throws MoneyError (map to HTTP 422 in the global exception filter).
 */

// ── Types and constants ──────────────────────────────────────────────────────

/** Integer minor units (e.g. toea). */
export type Minor = number;

export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'OTHER';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';

export const MINOR_PER_MAJOR = 100; // 2-decimal currencies (PGK)
export const BPS_DENOMINATOR = 10_000;

export type MoneyErrorCode =
  | 'NOT_INTEGER'
  | 'NEGATIVE'
  | 'INVALID_INPUT'
  | 'INVALID_QTY'
  | 'INVALID_RATE'
  | 'INVALID_DISCOUNT'
  | 'INVALID_WEIGHTS'
  | 'OVERPAYMENT'
  | 'INSUFFICIENT_TENDER'
  | 'INVALID_PAYMENT';

export class MoneyError extends Error {
  constructor(message: string, readonly code: MoneyErrorCode) {
    super(message);
    this.name = 'MoneyError';
  }
}

export interface PricedLine {
  unitPriceMinor: Minor;
  qty: number;
  /** price deltas of selected modifiers (may be negative, e.g. "no cheese -50") */
  modifierDeltasMinor?: readonly Minor[];
  voided?: boolean;
}

export type Discount =
  | { type: 'FIXED'; amountMinor: Minor }
  | { type: 'PERCENT'; bps: number };

export interface OrderTotalsInput {
  lines: readonly PricedLine[];
  taxRateBps: number;
  pricesIncludeTax: boolean;
  discount?: Discount;
}

export interface OrderTotals {
  /** Sum of line totals (tax-inclusive when pricesIncludeTax). */
  subtotalMinor: Minor;
  discountMinor: Minor;
  taxMinor: Minor;
  /** Amount the customer pays. */
  totalMinor: Minor;
  /** totalMinor - taxMinor. */
  netMinor: Minor;
}

// ── Guards ───────────────────────────────────────────────────────────────────

export function assertMinor(value: unknown, label = 'amount'): asserts value is Minor {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer in minor units`, 'NOT_INTEGER');
  }
}

export function assertNonNegativeMinor(value: unknown, label = 'amount'): asserts value is Minor {
  assertMinor(value, label);
  if (value < 0) throw new MoneyError(`${label} must not be negative`, 'NEGATIVE');
}

export function assertBps(value: unknown, label = 'rate'): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > BPS_DENOMINATOR) {
    throw new MoneyError(`${label} must be an integer between 0 and ${BPS_DENOMINATOR} bps`, 'INVALID_RATE');
  }
}

export function assertQty(value: unknown, label = 'qty'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new MoneyError(`${label} must be an integer >= 1`, 'INVALID_QTY');
  }
}

// ── Safe integer arithmetic ──────────────────────────────────────────────────

function checked(n: number, label = 'result'): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${label} overflows safe integer range`, 'NOT_INTEGER');
  return n;
}

export function addMinor(...values: Minor[]): Minor {
  return sumMinor(values);
}

export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total = checked(total + v, 'sum');
  }
  return total;
}

export function mulMinor(amount: Minor, factor: number): Minor {
  assertMinor(amount);
  if (!Number.isSafeInteger(factor)) throw new MoneyError('factor must be a safe integer', 'NOT_INTEGER');
  return checked(amount * factor, 'product');
}

/**
 * Integer division with rounding half away from zero.
 * roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3, roundDiv(4, 3) = 1.
 * Exact for |numerator| < 2^53 (enforced).
 */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) throw new MoneyError('numerator must be a safe integer', 'NOT_INTEGER');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new MoneyError('denominator must be a positive safe integer', 'INVALID_INPUT');
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const q = Math.floor(abs / denominator);
  const r = abs - q * denominator;
  const rounded = r * 2 >= denominator ? q + 1 : q;
  return rounded === 0 ? 0 : sign * rounded;
}

/** amount * bps / 10000, rounded half up. */
export function percentOf(amount: Minor, bps: number): Minor {
  assertMinor(amount);
  assertBps(bps);
  return roundDiv(mulMinor(amount, bps), BPS_DENOMINATOR);
}

/** part / whole expressed in bps (e.g. discount share), 0 when whole is 0. */
export function shareBps(part: Minor, whole: Minor): number {
  assertMinor(part, 'part');
  assertMinor(whole, 'whole');
  if (whole === 0) return 0;
  return roundDiv(mulMinor(part, BPS_DENOMINATOR), whole);
}

/** total / count rounded half up; 0 when count is 0 (average order value etc.). */
export function averageMinor(total: Minor, count: number): Minor {
  assertMinor(total, 'total');
  if (!Number.isSafeInteger(count) || count < 0) throw new MoneyError('count must be a non-negative integer', 'INVALID_INPUT');
  return count === 0 ? 0 : roundDiv(total, count);
}

// ── Parsing and formatting ───────────────────────────────────────────────────

/**
 * "12.5" | "12.50" | "-3.05" | 12.5  →  minor units. Rejects more than 2 decimals.
 * Prefer strings; numbers are accepted only if they are exactly representable at 2 dp.
 */
export function toMinor(input: string | number): Minor {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('amount must be a finite number', 'INVALID_INPUT');
    const scaled = input * MINOR_PER_MAJOR;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-7) {
      throw new MoneyError('amount has more than 2 decimal places', 'INVALID_INPUT');
    }
    text = input.toFixed(2);
  } else {
    text = input.trim();
  }

  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new MoneyError(`invalid money value "${input}"`, 'INVALID_INPUT');

  const [, neg, whole, frac = ''] = match;
  const minor = checked(Number(whole) * MINOR_PER_MAJOR + Number(frac.padEnd(2, '0')), 'amount');
  return neg && minor !== 0 ? -minor : minor;
}

/** 1250 → "12.50", -5 → "-0.05". Plain decimal string, no currency symbol. */
export function fromMinor(minor: Minor): string {
  assertMinor(minor);
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / MINOR_PER_MAJOR);
  const frac = String(abs % MINOR_PER_MAJOR).padStart(2, '0');
  return `${minor < 0 ? '-' : ''}${whole}.${frac}`;
}

/** Display formatting (UI/receipts only; never parse this back). */
export function formatMinor(minor: Minor, currency = 'PGK', locale = 'en-PG'): string {
  assertMinor(minor);
  const value = minor / MINOR_PER_MAJOR;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value);
  }
}

// ── Line items ───────────────────────────────────────────────────────────────

/** (unit price + modifier deltas) * qty. */
export function lineTotalMinor(line: Pick<PricedLine, 'unitPriceMinor' | 'qty' | 'modifierDeltasMinor'>): Minor {
  assertNonNegativeMinor(line.unitPriceMinor, 'unitPriceMinor');
  assertQty(line.qty);
  const unit = sumMinor([line.unitPriceMinor, ...(line.modifierDeltasMinor ?? [])]);
  if (unit < 0) throw new MoneyError('modifiers cannot make the unit price negative', 'NEGATIVE');
  return mulMinor(unit, line.qty);
}

// ── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxBreakdown {
  netMinor: Minor;
  taxMinor: Minor;
  grossMinor: Minor;
}

/** Prices exclude tax: tax is added on top. */
export function taxExclusive(netMinor: Minor, rateBps: number): TaxBreakdown {
  assertNonNegativeMinor(netMinor, 'net');
  const taxMinor = percentOf(netMinor, rateBps);
  return { netMinor, taxMinor, grossMinor: netMinor + taxMinor };
}

/** Prices include tax: tax is carved out of the gross amount. */
export function taxInclusive(grossMinor: Minor, rateBps: number): TaxBreakdown {
  assertNonNegativeMinor(grossMinor, 'gross');
  assertBps(rateBps);
  const netMinor = roundDiv(mulMinor(grossMinor, BPS_DENOMINATOR), BPS_DENOMINATOR + rateBps);
  return { netMinor, taxMinor: grossMinor - netMinor, grossMinor };
}

// ── Discounts ────────────────────────────────────────────────────────────────

/** Discount in minor units, always within [0, subtotal]. */
export function computeDiscount(subtotalMinor: Minor, discount?: Discount): Minor {
  assertNonNegativeMinor(subtotalMinor, 'subtotal');
  if (!discount) return 0;

  switch (discount.type) {
    case 'FIXED':
      assertNonNegativeMinor(discount.amountMinor, 'discount amount');
      return Math.min(discount.amountMinor, subtotalMinor);
    case 'PERCENT':
      assertBps(discount.bps, 'discount rate');
      return percentOf(subtotalMinor, discount.bps);
    default:
      throw new MoneyError('unknown discount type', 'INVALID_DISCOUNT');
  }
}

// ── Order / bill totals ──────────────────────────────────────────────────────

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  assertBps(input.taxRateBps, 'taxRateBps');

  const subtotalMinor = sumMinor(input.lines.filter((l) => !l.voided).map(lineTotalMinor));
  const discountMinor = computeDiscount(subtotalMinor, input.discount);
  const afterDiscount = subtotalMinor - discountMinor;

  if (input.pricesIncludeTax) {
    const { netMinor, taxMinor } = taxInclusive(afterDiscount, input.taxRateBps);
    return { subtotalMinor, discountMinor, taxMinor, totalMinor: afterDiscount, netMinor };
  }

  const { taxMinor, grossMinor } = taxExclusive(afterDiscount, input.taxRateBps);
  return { subtotalMinor, discountMinor, taxMinor, totalMinor: grossMinor, netMinor: afterDiscount };
}

// ── Allocation and splitting ─────────────────────────────────────────────────

/**
 * Split `amount` across `weights` so the parts sum EXACTLY to `amount`
 * (largest-remainder method; ties go to the lower index).
 * Uses: spreading a bill discount over lines, splitting a bill, tip pools.
 * allocate(100, [1, 1, 1]) → [34, 33, 33]
 */
export function allocate(amount: Minor, weights: readonly number[]): Minor[] {
  assertMinor(amount, 'amount');
  if (weights.length === 0) throw new MoneyError('weights must not be empty', 'INVALID_WEIGHTS');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new MoneyError('weights must be non-negative integers', 'INVALID_WEIGHTS');
  }
  const totalWeight = checked(weights.reduce((a, b) => a + b, 0), 'total weight');
  if (totalWeight <= 0) throw new MoneyError('total weight must be positive', 'INVALID_WEIGHTS');

  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);

  const products = weights.map((w) => checked(abs * w, 'allocation product'));
  const parts = products.map((p) => Math.floor(p / totalWeight));
  const remainders = products.map((p, i) => p - parts[i] * totalWeight);

  let leftover = abs - parts.reduce((a, b) => a + b, 0);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < leftover; k++) parts[order[k].i] += 1;

  return parts.map((p) => (p === 0 ? 0 : sign * p));
}

/** Split into `parts` near-equal shares; the first (amount % parts) shares get +1. */
export function splitEqually(amount: Minor, parts: number): Minor[] {
  if (!Number.isSafeInteger(parts) || parts < 1) throw new MoneyError('parts must be an integer >= 1', 'INVALID_INPUT');
  return allocate(amount, Array<number>(parts).fill(1));
}

// ── Payments ─────────────────────────────────────────────────────────────────

export function totalPaid(payments: readonly { amountMinor: Minor }[]): Minor {
  return sumMinor(payments.map((p) => p.amountMinor));
}

/** Outstanding balance, never negative. */
export function remainingMinor(totalMinor: Minor, payments: readonly { amountMinor: Minor }[]): Minor {
  assertNonNegativeMinor(totalMinor, 'total');
  return Math.max(0, totalMinor - totalPaid(payments));
}

export function paymentStatus(totalMinor: Minor, payments: readonly { amountMinor: Minor }[]): PaymentStatus {
  assertNonNegativeMinor(totalMinor, 'total');
  const paid = totalPaid(payments);
  if (paid === 0 && totalMinor > 0) return 'UNPAID';
  if (paid < totalMinor) return 'PARTIAL';
  if (paid === totalMinor) return 'PAID';
  return 'OVERPAID';
}

export interface PaymentInput {
  method: PaymentMethod;
  /** Amount applied to the bill. */
  amountMinor: Minor;
  /** Cash handed over; defaults to amountMinor. Must be omitted or equal for non-cash. */
  tenderedMinor?: Minor;
  /** Outstanding balance on the bill at the time of payment. */
  remainingMinor: Minor;
}

export interface ValidatedPayment {
  amountMinor: Minor;
  tenderedMinor: Minor;
  changeMinor: Minor;
  /** True when this payment settles the bill. */
  settlesBill: boolean;
}

export function validatePayment(input: PaymentInput): ValidatedPayment {
  const { method, amountMinor, remainingMinor: remaining } = input;
  assertMinor(amountMinor, 'amountMinor');
  assertNonNegativeMinor(remaining, 'remainingMinor');

  if (amountMinor <= 0) throw new MoneyError('payment amount must be greater than zero', 'INVALID_PAYMENT');
  if (amountMinor > remaining) {
    throw new MoneyError('payment exceeds the remaining balance', 'OVERPAYMENT');
  }

  const tendered = input.tenderedMinor ?? amountMinor;
  assertNonNegativeMinor(tendered, 'tenderedMinor');

  if (method === 'CASH') {
    if (tendered < amountMinor) throw new MoneyError('cash tendered is less than the amount', 'INSUFFICIENT_TENDER');
  } else if (tendered !== amountMinor) {
    throw new MoneyError('tendered amount only applies to cash payments', 'INVALID_PAYMENT');
  }

  return {
    amountMinor,
    tenderedMinor: tendered,
    changeMinor: tendered - amountMinor,
    settlesBill: amountMinor === remaining,
  };
}

// ── Cash rounding ────────────────────────────────────────────────────────────

/** Round to the nearest multiple of `step` minor units (half up). */
export function roundToIncrement(amount: Minor, step: number): Minor {
  assertMinor(amount);
  if (!Number.isSafeInteger(step) || step < 1) throw new MoneyError('step must be an integer >= 1', 'INVALID_INPUT');
  return mulMinor(roundDiv(amount, step), step);
}

/**
 * Cash-only rounding for denominations smaller than the smallest coin.
 * Apply to the cash amount due, record `adjustmentMinor` separately for reporting.
 * Confirm the step (and whether it is permitted for receipts) with the business.
 */
export function cashRoundingAdjustment(amountMinor: Minor, step = 5): { roundedMinor: Minor; adjustmentMinor: Minor } {
  const roundedMinor = roundToIncrement(amountMinor, step);
  return { roundedMinor, adjustmentMinor: roundedMinor - amountMinor };
}