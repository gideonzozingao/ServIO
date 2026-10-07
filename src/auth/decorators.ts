import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthedRequest, StaffRole } from './auth.types.js';

export const ROLES_KEY = 'servio:roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().authUser,
);

export const Tenant = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().tenant,
);