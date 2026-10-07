import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant-context.js';

/** SessionGuard is registered as APP_GUARD in AppModule (it needs AuthModule providers). */
@Global()
@Module({ providers: [TenantContext], exports: [TenantContext] })
export class TenancyModule {}
