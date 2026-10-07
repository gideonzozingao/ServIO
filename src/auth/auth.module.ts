import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { createAuth } from './auth.factory.js';
import { MeController } from '../me/me.controller.js';
import { SessionGuard, TenantGuard } from './guards.js';

export const AUTH = Symbol('AUTH');

@Global()
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: AUTH,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => createAuth(prisma),
    },
    SessionGuard,
    TenantGuard,
  ],
  exports: [AUTH, SessionGuard, TenantGuard],
})
export class AuthModule {}