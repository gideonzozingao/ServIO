import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, Roles, Tenant } from '../auth/decorators.js';
import { SessionGuard, TenantGuard } from '../auth/guards.js';

@Controller()
export class MeController {
  // GET /api/v1/me: any logged-in user
  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: { id: string; email: string; name: string }) {
    return user;
  }

  // GET /api/v1/tenant: needs an active restaurant and membership
  @Get('tenant')
  @UseGuards(TenantGuard)
  tenant(@Tenant() tenant: { organizationId: string; role: string }) {
    return tenant;
  }

  // GET /api/v1/tenant/manage: owner (always allowed) or manager
  @Get('tenant/manage')
  @UseGuards(TenantGuard)
  @Roles('manager')
  manage(@Tenant() tenant: { organizationId: string; role: string }) {
    return { ok: true, ...tenant };
  }
}
