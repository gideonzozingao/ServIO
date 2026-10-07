import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestSession, StaffRole } from '../../common/types/tx.type.js';

const KEY = 'servio.tenant';

/** Per-request identity (nestjs-cls / AsyncLocalStorage). Populated by SessionGuard. */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService) {}

  set(state: RequestSession): void {
    this.cls.set(KEY, state);
  }

  /** Throws when unauthenticated. */
  get(): RequestSession {
    const s = this.tryGet();
    if (!s) throw new UnauthorizedException();
    return s;
  }

  /** Undefined outside HTTP requests (jobs, hooks). */
  tryGet(): RequestSession | undefined {
    return this.cls.isActive() ? this.cls.get<RequestSession>(KEY) : undefined;
  }

  get restaurantId(): string {
    return this.get().restaurantId;
  }
  get userId(): string {
    return this.get().userId;
  }
  get role(): StaffRole {
    return this.get().role;
  }
  isManager(): boolean {
    return this.role === 'owner' || this.role === 'manager';
  }
}
