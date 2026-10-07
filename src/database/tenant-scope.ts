import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The restaurant id for the current unit of work. Set ONLY by withTenant(), read by the tenant
 * extension and by raw-SQL helpers. Independent of the HTTP request context, so jobs and hooks
 * get the same guarantees.
 */
const scope = new AsyncLocalStorage<string>();

export const tenantScope = {
  run<T>(restaurantId: string, fn: () => T): T {
    return scope.run(restaurantId, fn);
  },
  current(): string | undefined {
    return scope.getStore();
  },
  require(): string {
    const id = scope.getStore();
    if (!id)
      throw new Error(
        'Tenant scope missing: tenant-owned data must be accessed inside withTenant()',
      );
    return id;
  },
};

/** Current tenant id inside withTenant(). Use for `restaurantId` on creates (the extension enforces the same value). */
export const rid = (): string => tenantScope.require();
