import type { TenantTx } from '../common/types/tx.type.js';
import { Prisma } from './prisma-client.js';
import type { PrismaService } from './prisma.service.js';
import { tenantScope } from './tenant-scope.js';

export interface TenantTxOptions {
  timeout?: number;
  maxWait?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * One unit of tenant work: interactive transaction whose first statement sets the RLS variable
 * (transaction-local, safe on pooled connections). Everything inside `fn` — extension-scoped queries,
 * raw SQL, audit writes — shares one transaction and one tenant.
 *
 * Emit domain events AFTER this resolves, never inside `fn`.
 */
export function withTenant<T>(
  prisma: PrismaService,
  restaurantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts: TenantTxOptions = {},
): Promise<T> {
  if (!restaurantId) throw new Error('withTenant: restaurantId is required');
  const outer = tenantScope.current();
  if (outer && outer !== restaurantId)
    throw new Error('withTenant: nested call with a different tenant');

  return tenantScope.run(restaurantId, () =>
    prisma.app.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_restaurant', ${restaurantId}, TRUE)`;
        return fn(tx as unknown as TenantTx);
      },
      { timeout: 10_000, maxWait: 5_000, ...opts },
    ),
  );
}
