import { randomBytes } from 'node:crypto';

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/, '');
  return s.length >= 3 ? s : `restaurant-${s}`.replace(/-+$/, '');
}

/** First free of: base, base-2..base-5, then base-<random>. */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const candidates = [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)];
  for (const c of candidates) if (!(await taken(c))) return c;
  return `${base}-${randomBytes(3).toString('hex')}`;
}
