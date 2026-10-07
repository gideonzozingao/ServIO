import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

export const SESSION_ONLY = 'servio:session-only';

/**
 * Route needs a signed-in user but NOT an active restaurant (account settings, accepting an
 * invitation, switching restaurants). The tenant context is still populated when available.
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

export interface SessionUser {
  userId: string;
  sessionId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  activeRestaurantId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.servioUser) throw new UnauthorizedException();
    return req.servioUser as SessionUser;
  },
);
