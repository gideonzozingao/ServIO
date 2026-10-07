import { Statement } from './../../../modules/auth/access-control.js';
import { SetMetadata } from '@nestjs/common';
export const PERMISSION_KEY = 'servio:permission';

export interface PermissionRequirement {
  resource: keyof Statement;
  action: string;
}

/** Enforced by the global PermissionGuard against the member's organization role. */
export const RequirePermission = <R extends keyof Statement>(
  resource: R,
  action: Statement[R][number],
) =>
  SetMetadata(PERMISSION_KEY, {
    resource,
    action,
  } satisfies PermissionRequirement);
