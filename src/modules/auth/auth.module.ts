import { AccountAuthService } from './account-auth.service.js';

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { AuthPrismaClient } from '../../database/auth-prisma.client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainEvents } from '../../infrastructure/events/domain-events.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { createAuth, BETTER_AUTH } from './auth.config.js';
import { MeController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ManagerApprovalGuard } from './guards/manager-approval.guard.js';
import { PermissionGuard } from './guards/permission.guard.js';
import { createRestaurantForOrganization } from './hooks/organization-after-create.hook.js';
import { ManagerApprovalService } from './manager-approval.service.js';
import { MemberRoleService } from './member-role.service.js';
import { templates } from '../../infrastructure/mail/mail.templates.js';
import { MailerService } from '../../infrastructure/mail/mailer.service.js';
const mailLog = new Logger('Mailer');

@Global()
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: BETTER_AUTH,
      inject: [AuthPrismaClient, RedisService, ConfigService, PrismaService, DomainEvents],
      useFactory: (authPrisma: AuthPrismaClient, redis: RedisService, config: ConfigService, prisma: PrismaService, events: DomainEvents, mailer: MailerService) => {
        const app = config.getOrThrow<AppConfig>('app');
        return createAuth({
          prisma: authPrisma,
          secret: app.auth.secret,
          baseURL: app.auth.baseUrl,
          trustedOrigins: app.corsOrigins,
          trustedProxies: app.trustedProxies.length ? app.trustedProxies : undefined,
          secondaryStorage: redis.asSecondaryStorage(),
          staff: {
            pinPepper: app.auth.pinPepper,
            staffSessionHours: app.auth.staffSessionHours,
            onDeviceRevoked: (e: { organizationId: string; deviceId: string }) =>
              events.emit('device.revoked', { restaurantId: e.organizationId, deviceId: e.deviceId }),
          },
          onOrganizationCreated: createRestaurantForOrganization(prisma),
          // TODO(mail provider, open question): replace with SES/Postmark.
          sendResetPassword: async (email, url) => mailLog.warn(`password reset for ${email}: ${url}`),
        });
      },
    },
    AuthService,
    MemberRoleService,
    ManagerApprovalService,
    AccountAuthService,
    PermissionGuard,
    ManagerApprovalGuard,
  ],
  exports: [BETTER_AUTH, AuthService, AccountAuthService, MemberRoleService, ManagerApprovalService, PermissionGuard, ManagerApprovalGuard],
})
export class AuthModule {}