import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI, organization } from 'better-auth/plugins';
import { PrismaClient } from '../generated/prisma/client.js';

export const createAuth = (prisma: PrismaClient) =>
  betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.CORS_ORIGINS?.split(',') ?? [],
    emailAndPassword: { enabled: true },
    advanced: {
      database: { generateId: 'uuid' }, // schema uses @db.Uuid everywhere
    },
    plugins: [
      organization(),
      ...(process.env.NODE_ENV !== 'production' ? [openAPI()] : []),
    ],
  });
