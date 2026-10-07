import { Controller, Get, INestApplication } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';

import type { RequestSession } from '../../common/types/tx.type.js';
import { AuthPrismaClient } from '../../database/auth-prisma.client.js';
import { permissionsFor } from './access-control.js';
import { BETTER_AUTH, type AuthInstance } from './auth.config.js';
import { CurrentSession } from '../../common/decorators/current-session/current-session.decorator.js';

/**
 * Mounts Better Auth at /api/auth/* directly on Express, BEFORE the JSON body parser
 * (Better Auth reads the raw body itself). Call from main.ts before app.use(express.json()).
 */
export function mountBetterAuth(app: INestApplication): void {
  const auth = app.get<AuthInstance>(BETTER_AUTH);
  app.getHttpAdapter().getInstance().all('/api/auth/{*path}', toNodeHandler(auth));
}

@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(private readonly authPrisma: AuthPrismaClient) {}

  /** Session + role + flattened permissions for client UI gating. */
  @Get()
  async me(@CurrentSession() s: RequestSession) {
    const user = await this.authPrisma.user.findUnique({ where: { id: s.userId }, select: { id: true, name: true, email: true, image: true } });
    return { user, restaurantId: s.restaurantId, role: s.role, deviceId: s.deviceId, permissions: permissionsFor(s.role) };
  }
}
