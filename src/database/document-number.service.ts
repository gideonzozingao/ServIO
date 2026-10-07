import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../common/types/tx.type.js';
import type { CounterScope } from './prisma-client.js';
import { tenantScope } from './tenant-scope.js';

/** Human-friendly per-day numbers (order #17, bill #9) without table locks. */
@Injectable()
export class DocumentNumberService {
  async next(
    tx: TenantTx,
    scope: CounterScope,
    businessDate: Date,
  ): Promise<number> {
    const restaurantId = tenantScope.require();
    const day = businessDate.toISOString().slice(0, 10);
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO document_counters (restaurant_id, scope, business_date, last_value)
      VALUES (${restaurantId}, ${scope}::"CounterScope", ${day}::date, 1)
      ON CONFLICT (restaurant_id, scope, business_date)
      DO UPDATE SET last_value = document_counters.last_value + 1
      RETURNING last_value`;
    return Number(rows[0].last_value);
  }
}
