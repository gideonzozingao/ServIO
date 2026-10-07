import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../common/types/tx.type.js';
import { TenantContext } from '../infrastructure/tenancy/tenant-context.js';
import { PrismaService } from './prisma.service.js';
import { tenantScope } from './tenant-scope.js';
import { TenantTxOptions, withTenant } from './with-tenant.js';

/** Request-scoped convenience over withTenant(): uses the tenant from the authenticated session. */
@Injectable()
export class TenantPrismaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
  ) {}

  /** Active tenant: the open withTenant() scope if any, else the session's restaurant. */
  get restaurantId(): string {
    return tenantScope.current() ?? this.ctx.restaurantId;
  }

  run<T>(fn: (tx: TenantTx) => Promise<T>, opts?: TenantTxOptions): Promise<T> {
    return withTenant(this.prisma, this.ctx.restaurantId, fn, opts);
  }

  /** Explicit tenant (jobs, hooks, socket handlers with no HTTP context). */
  runFor<T>(restaurantId: string, fn: (tx: TenantTx) => Promise<T>, opts?: TenantTxOptions): Promise<T> {
    return withTenant(this.prisma, restaurantId, fn, opts);
  }
}
