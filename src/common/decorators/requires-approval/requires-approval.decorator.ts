import { ManagerApprovalGuard } from './../../../modules/guards/manager-approval.guard.js';
import { Reflector } from '@nestjs/core';

// export const RequiresApproval = Reflector.createDecorator<string[]>();
import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
// import { ManagerApprovalGuard } from '../../modules/auth/guards/manager-approval.guard.js';
export const APPROVAL_ACTION_KEY = 'servio:approval-action';
export const APPROVAL_HEADER = 'x-approval-token';
export type ApprovalAction = 'order.void' | 'item.void' | 'bill.discount';
export const APPROVAL_ACTIONS: ApprovalAction[] = ['order.void', 'item.void', 'bill.discount'];

/**
 * Route requires a manager approval token. The guard only checks presence; the token is
 * verified and consumed atomically inside the use case's transaction (single use, bound to action + subject).
 */
export const RequiresApproval = (action: ApprovalAction) =>
  applyDecorators(
    SetMetadata(APPROVAL_ACTION_KEY, action),
    UseGuards(ManagerApprovalGuard),
    ApiHeader({ name: 'X-Approval-Token', required: true }),
  );

/** Optional variant (item void needs approval only once the item has been sent). */
export const ApprovalToken = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const value = ctx.switchToHttp().getRequest().headers[APPROVAL_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
});
