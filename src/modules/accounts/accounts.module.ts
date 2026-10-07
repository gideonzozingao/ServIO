import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';

/**
 * Registration (public owner sign-up, invitation acceptance), invitation management, and account self-service.
 * Writes to Better Auth tables go through AuthModule services (AccountAuthService / AuthService).
 */
@Module({
  imports: [StaffModule],
  controllers: [RegistrationController, InvitationsController, AccountController],
  providers: [RegistrationService, InvitationsService, AccountService],
})
export class AccountsModule {}
