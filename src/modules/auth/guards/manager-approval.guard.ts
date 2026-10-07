import { APPROVAL_HEADER } from './../../../common/decorators/requires-approval/requires-approval.decorator.js';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Fast-fail: the header must be present. Real verification + single-use consumption happens in
 * ManagerApprovalService.consume() inside the use case's transaction.
 */
@Injectable()
export class ManagerApprovalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = context.switchToHttp().getRequest().headers[APPROVAL_HEADER];
    if (typeof token !== 'string' || token.length < 20) {
      throw new ForbiddenException({
        message: 'Manager approval required',
        code: 'APPROVAL_REQUIRED',
      });
    }
    return true;
  }
}
