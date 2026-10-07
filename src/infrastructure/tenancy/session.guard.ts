import { IS_PUBLIC } from './../../common/decorators/public/public.decorator.js';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
// import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';

import type { RequestSession } from '../../common/types/tx.type.js';
import {
  BETTER_AUTH,
  type AuthInstance,
} from '../../modules/auth/auth.config.js';
import { MemberRoleService } from '../../modules/auth/member-role.service.js';
import { TenantContext } from './tenant-context.js';

/**
 * Global guard: Better Auth session → active restaurant → member role → TenantContext.
 * `@Public()` opts out. Every authenticated request has a tenant; no tenant = 403.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(BETTER_AUTH) private readonly auth: AuthInstance,
    private readonly members: MemberRoleService,
    private readonly ctx: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { servio?: RequestSession }>();
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!result) throw new UnauthorizedException('Not signed in');

    const session = result.session as typeof result.session & {
      activeOrganizationId?: string | null;
      deviceId?: string | null;
    };
    const restaurantId = session.activeOrganizationId;
    if (!restaurantId)
      throw new ForbiddenException('No active restaurant on this session');

    const role = await this.members.roleOf(restaurantId, result.user.id);
    if (!role) throw new ForbiddenException('Not a member of this restaurant');

    const state: RequestSession = {
      sessionId: session.id,
      userId: result.user.id,
      restaurantId,
      role,
      deviceId: session.deviceId ?? null,
    };
    req.servio = state;
    this.ctx.set(state);
    return true;
  }
}
