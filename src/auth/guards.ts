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
import { PrismaService } from '../prisma/prisma.service.js';
import { AUTH } from './auth.module.js';
import type { Auth, AuthedRequest, StaffRole } from './auth.types.js';
import { ROLES_KEY } from './decorators.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) protected readonly auth: Auth) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!result) throw new UnauthorizedException();
    req.authUser = result.user as AuthedRequest['authUser'];
    req.authSession = result.session as AuthedRequest['authSession'];
    return true;
  }
}

@Injectable()
export class TenantGuard extends SessionGuard {
  constructor(
    @Inject(AUTH) auth: Auth,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {
    super(auth);
  }

  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    const organizationId = req.authSession.activeOrganizationId;
    if (!organizationId) {
      throw new ForbiddenException('No active restaurant selected');
    }

    const member = await this.prisma.member.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: req.authUser.id },
      },
      select: { role: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this restaurant');

    const held = member.role.split(',').map((r: string) => r.trim());
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (required?.length && !held.includes('owner')) {
      if (!required.some((r) => held.includes(r))) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    req.tenant = { organizationId, role: member.role };
    return true;
  }
}