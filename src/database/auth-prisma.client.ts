import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../config/configuration.js';
import { PrismaClient } from './prisma-client.js';

/**
 * Base client for Better Auth (DB role servio_auth, auth tables only, no RLS, no extensions).
 * Inject it ONLY in the auth module (enforced by lint: no-restricted-imports outside modules/auth).
 */
@Injectable()
export class AuthPrismaClient extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<AppConfig>('app').authDatabaseUrl,
      }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
