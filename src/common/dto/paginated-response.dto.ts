export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): Paginated<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
