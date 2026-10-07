import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MoneyError, toMinor, fromMinor, formatMinor, roundDiv, percentOf, lineTotalMinor,
  taxExclusive, taxInclusive, computeDiscount, computeOrderTotals, allocate, splitEqually,
  remainingMinor, paymentStatus, validatePayment, roundToIncrement, cashRoundingAdjustment,
  averageMinor, shareBps,
} from './money.utils.js';

test('toMinor / fromMinor', () => {
  assert.equal(toMinor('12.50'), 1250);
  assert.equal(toMinor('12.5'), 1250);
  assert.equal(toMinor('12'), 1200);
  assert.equal(toMinor('-0.05'), -5);
  assert.equal(toMinor(19.99), 1999);
  assert.throws(() => toMinor('1.005'), MoneyError);
  assert.throws(() => toMinor(0.001), MoneyError);
  assert.throws(() => toMinor('abc'), MoneyError);
  assert.equal(fromMinor(1250), '12.50');
  assert.equal(fromMinor(-5), '-0.05');
  assert.equal(fromMinor(0), '0.00');
  assert.match(formatMinor(1250), /12\.50/);
});

test('roundDiv half away from zero', () => {
  assert.equal(roundDiv(5, 2), 3);
  assert.equal(roundDiv(-5, 2), -3);
  assert.equal(roundDiv(4, 3), 1);
  assert.equal(roundDiv(0, 7), 0);
  assert.throws(() => roundDiv(1, 0), MoneyError);
  assert.equal(percentOf(10000, 1000), 1000);
  assert.equal(percentOf(999, 1000), 100); // 99.9 → 100
});

test('line totals', () => {
  assert.equal(lineTotalMinor({ unitPriceMinor: 2500, qty: 2, modifierDeltasMinor: [300, -50] }), 5500);
  assert.throws(() => lineTotalMinor({ unitPriceMinor: 100, qty: 0 }), MoneyError);
  assert.throws(() => lineTotalMinor({ unitPriceMinor: 100, qty: 1, modifierDeltasMinor: [-200] }), MoneyError);
});

test('tax exclusive and inclusive', () => {
  assert.deepEqual(taxExclusive(10000, 1000), { netMinor: 10000, taxMinor: 1000, grossMinor: 11000 });
  assert.deepEqual(taxInclusive(11000, 1000), { netMinor: 10000, taxMinor: 1000, grossMinor: 11000 });
  const odd = taxInclusive(1000, 1000);
  assert.equal(odd.netMinor + odd.taxMinor, 1000);
  assert.equal(odd.netMinor, 909);
  assert.equal(odd.taxMinor, 91);
});

test('discounts are capped', () => {
  assert.equal(computeDiscount(10000, { type: 'PERCENT', bps: 1000 }), 1000);
  assert.equal(computeDiscount(500, { type: 'FIXED', amountMinor: 900 }), 500);
  assert.equal(computeDiscount(500), 0);
  assert.throws(() => computeDiscount(500, { type: 'PERCENT', bps: 10001 }), MoneyError);
});

test('order totals: exclusive with percent discount', () => {
  const t = computeOrderTotals({
    lines: [{ unitPriceMinor: 5000, qty: 2 }, { unitPriceMinor: 900, qty: 1, voided: true }],
    taxRateBps: 1000, pricesIncludeTax: false, discount: { type: 'PERCENT', bps: 1000 },
  });
  assert.deepEqual(t, { subtotalMinor: 10000, discountMinor: 1000, taxMinor: 900, totalMinor: 9900, netMinor: 9000 });
});

test('order totals: inclusive', () => {
  const t = computeOrderTotals({
    lines: [{ unitPriceMinor: 11000, qty: 1 }], taxRateBps: 1000, pricesIncludeTax: true,
  });
  assert.deepEqual(t, { subtotalMinor: 11000, discountMinor: 0, taxMinor: 1000, totalMinor: 11000, netMinor: 10000 });
});

test('allocate / split sum exactly', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitEqually(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(0, [3, 2]), [0, 0]);
  const lines = [1250, 3300, 799];
  const parts = allocate(777, lines);
  assert.equal(parts.reduce((a, b) => a + b, 0), 777);
  assert.throws(() => allocate(10, [0, 0]), MoneyError);
});

test('payments', () => {
  assert.equal(remainingMinor(10000, [{ amountMinor: 4000 }]), 6000);
  assert.equal(paymentStatus(10000, []), 'UNPAID');
  assert.equal(paymentStatus(10000, [{ amountMinor: 4000 }]), 'PARTIAL');
  assert.equal(paymentStatus(10000, [{ amountMinor: 4000 }, { amountMinor: 6000 }]), 'PAID');
  assert.equal(paymentStatus(10000, [{ amountMinor: 10100 }]), 'OVERPAID');

  const cash = validatePayment({ method: 'CASH', amountMinor: 4500, tenderedMinor: 5000, remainingMinor: 4500 });
  assert.deepEqual(cash, { amountMinor: 4500, tenderedMinor: 5000, changeMinor: 500, settlesBill: true });

  assert.throws(() => validatePayment({ method: 'CASH', amountMinor: 4500, tenderedMinor: 4000, remainingMinor: 4500 }), { code: 'INSUFFICIENT_TENDER' });
  assert.throws(() => validatePayment({ method: 'CARD', amountMinor: 5000, remainingMinor: 4500 }), { code: 'OVERPAYMENT' });
  assert.throws(() => validatePayment({ method: 'CARD', amountMinor: 1000, tenderedMinor: 2000, remainingMinor: 4500 }), { code: 'INVALID_PAYMENT' });
  assert.throws(() => validatePayment({ method: 'CASH', amountMinor: 0, remainingMinor: 4500 }), { code: 'INVALID_PAYMENT' });
});

test('cash rounding and reporting helpers', () => {
  assert.equal(roundToIncrement(1003, 5), 1005);
  assert.equal(roundToIncrement(1002, 5), 1000);
  assert.deepEqual(cashRoundingAdjustment(1003), { roundedMinor: 1005, adjustmentMinor: 2 });
  assert.equal(averageMinor(10000, 3), 3333);
  assert.equal(averageMinor(10000, 0), 0);
  assert.equal(shareBps(1000, 10000), 1000);
});