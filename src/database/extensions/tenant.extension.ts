import { Prisma } from '../prisma-client.js';
import { tenantScope } from '../tenant-scope.js';

/** Prisma model names that carry restaurant_id and must always be scoped. */
export const TENANT_MODELS = new Set<string>([
  'Station', 'DiningTable', 'Category', 'MenuItem', 'ModifierGroup', 'Modifier',
  'Order', 'OrderItem', 'OrderItemModifier', 'KitchenTicket', 'Bill', 'Payment',
  'IdempotencyKey', 'AuditLog', 'DocumentCounter', 'DailySalesSummary',
]);

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany',
]);

/**
 * Injects restaurantId into `where` (reads/updates/deletes) and `data` (creates) for tenant models.
 * Fails closed when no tenant scope is active.
 *
 * Caveats (by design, keep code within them):
 *  - Use UNCHECKED inputs (scalar foreign keys like `orderId`), not `relation: { connect }`;
 *    Prisma rejects mixing them with the injected scalar `restaurantId`.
 *  - Nested writes (`items: { create: [...] }`) are NOT rewritten: set restaurantId explicitly there.
 *    RLS WITH CHECK still rejects a wrong value.
 *  - Raw SQL is not rewritten: RLS covers it; add `restaurant_id = ${rid}` for index use.
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'servio-tenant',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const restaurantId = tenantScope.require();
        const a = { ...(args as Record<string, any>) };

        if (WHERE_OPS.has(operation)) {
          a.where = { ...(a.where ?? {}), restaurantId };
        } else if (operation === 'create') {
          a.data = { ...(a.data ?? {}), restaurantId };
        } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const rows = Array.isArray(a.data) ? a.data : [a.data];
          a.data = rows.map((d: object) => ({ ...d, restaurantId }));
        } else if (operation === 'upsert') {
          a.where = { ...(a.where ?? {}), restaurantId };
          a.create = { ...(a.create ?? {}), restaurantId };
        }
        return query(a as typeof args);
      },
    },
  },
});
