import { AllExceptionsFilter } from './common/filters/all-exceptions/all-exceptions.filter.js';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
// import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { configuration, type AppConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './infrastructure/audit/audit.module.js';
import { EventsModule } from './infrastructure/events/events.module.js';
import { HealthModule } from './infrastructure/health/health.module.js';
import { IdempotencyModule } from './infrastructure/idempotency/idempotency.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { SessionGuard } from './infrastructure/tenancy/session.guard.js';
import { TenancyModule } from './infrastructure/tenancy/tenancy.module.js';
import { bullConnection } from './jobs/redis-connection.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PermissionGuard } from './modules/auth/guards/permission.guard.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { FloorModule } from './modules/floor/floor.module.js';
import { KitchenModule } from './modules/kitchen/kitchen.module.js';
import { OrderFlowModule } from './modules/order-flow/order-flow.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { StaffModule } from './modules/staff/staff.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
/** Shared by AppModule and WorkerModule. */
export const CORE_IMPORTS = [
  ConfigModule.forRoot({ isGlobal: true, cache: true, load: [configuration] }),
  ClsModule.forRoot({ global: true, middleware: { mount: true } }),
  EventEmitterModule.forRoot({ wildcard: false }),
  BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (c: ConfigService) => ({
      connection: bullConnection(c.getOrThrow<AppConfig>('app').redisUrl),
    }),
  }),
  DatabaseModule,
  RedisModule,
  TenancyModule,
  EventsModule,
  AuditModule,
  AuthModule,
  MailModule,
  AccountsModule,
];

@Module({
  imports: [
    ...CORE_IMPORTS,
    // In-memory throttling per instance. For multiple API instances, plug a Redis storage
    // (e.g. @nest-lab/throttler-storage-redis). Better Auth rate-limits /api/auth/* itself via Redis.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    IdempotencyModule,
    HealthModule,
    StaffModule,
    SettingsModule,
    CatalogModule,
    FloorModule,
    OrdersModule,
    KitchenModule,
    BillingModule,
    OrderFlowModule,
    RealtimeModule,
    ReportingModule,
  ],
  providers: [
    // Order matters: throttle → authenticate (tenant context) → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
