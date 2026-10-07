/** All money is integer minor units (toea for PGK). Never use floats for amounts. */

/** round(a * num / den), half-up, without floats. */
export function mulDivRound(a: number, num: number, den: number): number {
  if (a < 0) return -mulDivRound(-a, num, den);
  return Math.floor((2 * a * num + den) / (2 * den));
}

export function sumMinor(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function formatMinor(minor: number, currency = 'PGK'): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
