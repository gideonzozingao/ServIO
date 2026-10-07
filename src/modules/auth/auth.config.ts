import { expo } from '@better-auth/expo';
import { randomUUID } from 'node:crypto';
import { betterAuth, type SecondaryStorage } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, organization } from 'better-auth/plugins';
import type { PrismaClient } from '../../database/prisma-client.js';
import { ac, roles } from './access-control.js';
import {
  staffDevice,
  type StaffDeviceOptions,
} from './plugins/staff-device/staff-device.plugin.js';

export const BETTER_AUTH = Symbol('BETTER_AUTH');

export interface AuthDeps {
  prisma: PrismaClient; // AuthPrismaClient (servio_auth role), no extensions
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  trustedProxies?: string[];
  secondaryStorage?: SecondaryStorage;
  staff: StaffDeviceOptions;
  onOrganizationCreated?: (organizationId: string) => Promise<void>;
  sendResetPassword?: (email: string, url: string) => Promise<void>;
  /** Sends the "confirm your email" link. Required for self-signup (requireEmailVerification is on). */
  sendVerificationEmail?: (email: string, url: string) => Promise<void>;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: 'Servio',
    database: prismaAdapter(deps.prisma, { provider: 'postgresql' }),
    secret: deps.secret,
    baseURL: deps.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [...deps.trustedOrigins, 'waiterapp://'],

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Owners who self-register cannot sign in until they confirm their email.
      // Admin-created owner/manager accounts must be created with emailVerified: true.
      // Floor staff never use email sign-in (placeholder email, PIN only), so they are unaffected.
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendResetPassword?.(user.email, url);
      },
    },

    emailVerification: {
      // Accounts are created through the adapter (AuthService), which bypasses sign-up hooks,
      // so RegistrationService calls auth.api.sendVerificationEmail explicitly instead.
      sendOnSignUp: false,
      // An unverified owner who tries to sign in gets a fresh link.
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendVerificationEmail?.(user.email, url);
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // owner/manager email sessions
      // Staff PIN sessions carry their own shift-length expiresAt. Sliding refresh would extend them
      // to expiresIn, so refresh is disabled globally (owners re-login weekly).
      disableSessionRefresh: true,
      // Sessions live in Redis (secondaryStorage) AND Postgres, so we can find/revoke them by deviceId.
      storeSessionInDatabase: true,
      cookieCache: { enabled: false }, // revocation must be immediate for destructive roles
    },

    advanced: {
      // Nginx must set `X-Real-IP $remote_addr` (overwrite, never pass the client's). Without a client IP,
      // Better Auth rate-limits everyone in one shared bucket (one attacker could block all PIN logins).
      ipAddress: {
        ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'],
        trustedProxies: deps.trustedProxies,
      },
      // App-side UUIDs: with 'uuid', Better Auth defers to a gen_random_uuid() DB default that the
      // generated auth.prisma doesn't declare. A function works regardless of schema defaults.
      database: { generateId: () => randomUUID() },
    },

    secondaryStorage: deps.secondaryStorage,

    databaseHooks: {
      session: {
        create: {
          // Email sign-in creates sessions without an active restaurant. Default to the user's first
          // membership so owners/managers land in their restaurant (multi-branch later: set-active switches).
          // PIN sessions already carry activeOrganizationId from the device.
          before: async (session) => {
            const s = session as typeof session & {
              activeOrganizationId?: string | null;
            };
            if (s.activeOrganizationId) return;
            const m = await deps.prisma.member.findFirst({
              where: { userId: s.userId },
              orderBy: { createdAt: 'asc' },
              select: { organizationId: true },
            });
            if (m)
              return { data: { ...s, activeOrganizationId: m.organizationId } };
          },
        },
      },
    },

    rateLimit: {
      enabled: true,
      storage: deps.secondaryStorage ? 'secondary-storage' : 'memory',
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },

    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        // Restaurants are provisioned by AuthService.provisionRestaurant(), never self-service.
        allowUserToCreateOrganization: false,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            await deps.onOrganizationCreated?.(org.id);
          },
        },
      }),
      bearer(),
      expo(),
      staffDevice(deps.staff),
      // post-MVP: twoFactor(), passkey() for owner/manager
    ],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
