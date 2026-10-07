import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../config/configuration.js';
import { PrismaClient } from './prisma-client.js';
import { authModelGuardExtension } from './extensions/auth-model-guard.extension.js';
import { tenantExtension } from './extensions/tenant.extension.js';

function buildAppClient(base: PrismaClient) {
  return base.$extends(authModelGuardExtension).$extends(tenantExtension);
}
export type AppPrismaClient = ReturnType<typeof buildAppClient>;

/**
 * Runtime client (DB role servio_app, subject to RLS).
 * Services never use this directly: they receive a TenantTx from TenantPrismaService.run()/withTenant().
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly base: PrismaClient;
  readonly app: AppPrismaClient;

  constructor(config: ConfigService) {
    const { databaseUrl, isProd } = config.getOrThrow<AppConfig>('app');
    this.base = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      log: isProd ? [{ emit: 'event', level: 'warn' }] : [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'warn' }],
    });
    (this.base as any).$on('query', (e: { duration: number; query: string }) => {
      if (e.duration > 200) this.logger.warn(`slow query ${e.duration}ms: ${e.query.slice(0, 300)}`);
    });
    this.app = buildAppClient(this.base);
  }

  async onModuleInit() {
    await this.base.$connect();
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
