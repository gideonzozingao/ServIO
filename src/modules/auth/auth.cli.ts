/**
 * Entry for `npx @better-auth/cli generate` only (it needs a module exporting `auth`).
 * Not imported by the app. Values are placeholders; generation reads the schema, not the DB.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../database/prisma-client.js';
import { createAuth } from './auth.config.js';

export const auth = createAuth({
  prisma: new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.AUTH_DATABASE_URL ?? 'postgresql://localhost/servio',
    }),
  }),
  secret:
    process.env.BETTER_AUTH_SECRET ?? 'cli-only-secret-cli-only-secret-xx',
  baseURL: 'http://localhost:3000',
  trustedOrigins: [],
  staff: { pinPepper: 'cli-only', staffSessionHours: 12 },
});
