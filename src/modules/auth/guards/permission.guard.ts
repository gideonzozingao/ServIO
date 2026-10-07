import { PERMISSION_KEY, type PermissionRequirement } from './../../../common/decorators/require-permission/require-permission.decorator.js';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// import { PERMISSION_KEY, type PermissionRequirement } from '../../../common/decorators/require-permission.decorator.js';


import type { RequestSession } from '../../../common/types/tx.type.js';
import { hasPermission } from '../access-control.js';

/**
 * Global guard (after SessionGuard). Checks the member role against the access-control statements
 * locally — same `ac` Better Auth uses, no extra round trip per request.
 * Routes without @RequirePermission are open to any authenticated member of the restaurant.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = this.reflector.getAllAndOverride<PermissionRequirement>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!req) return true;
    const session = context.switchToHttp().getRequest<{ servio?: RequestSession }>().servio;
    if (!session) throw new UnauthorizedException();
    if (!hasPermission(session.role, req.resource, req.action as never)) {
      throw new ForbiddenException({ message: `Missing permission ${req.resource}:${req.action}`, code: 'FORBIDDEN' });
    }
    return true;
  }
}
