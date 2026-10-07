import { Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '../common/types/tx.type.js';
import { PrismaService } from '../database/prisma.service.js';
import { withTenant } from '../database/with-tenant.js';

/**
 * Background work runs per restaurant inside withTenant(), so RLS applies exactly as for requests.
 * Restaurants are enumerated from the non-RLS `organization` table (servio_app has SELECT on it).
 */
@Injectable()
export class TenantJobRunner {
  private readonly logger = new Logger(TenantJobRunner.name);
  constructor(private readonly prisma: PrismaService) {}

  async restaurantIds(): Promise<string[]> {
    const rows = await this.prisma.app.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM organization ORDER BY created_at`;
    return rows.map((r) => r.id);
  }

  run<T>(restaurantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, restaurantId, fn, { timeout: 60_000 });
  }

  /** One failing tenant never blocks the others. */
  async forEach(fn: (restaurantId: string) => Promise<void>, only?: string): Promise<{ ok: number; failed: number }> {
    const ids = only ? [only] : await this.restaurantIds();
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await fn(id);
        ok++;
      } catch (e) {
        failed++;
        this.logger.error(`tenant ${id}: ${(e as Error).message}`);
      }
    }
    return { ok, failed };
  }
}
