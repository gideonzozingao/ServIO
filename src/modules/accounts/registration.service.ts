import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { DomainConflictException } from '../../common/exceptions/domain.exceptions.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import { templates } from '../../infrastructure/mail/mail.templates.js';
import { MailerService } from '../../infrastructure/mail/mailer.service.js';
import { AccountAuthService } from '../auth/account-auth.service.js';
import { BETTER_AUTH, type AuthInstance } from '../auth/auth.config.js';
import { AuthService } from '../auth/auth.service.js';
import { createRestaurantForOrganization } from '../auth/hooks/organization-after-create.hook.js';
import type { AcceptInvitationDto, RegisterDto } from './dto/accounts.dto.js';
import { slugify, uniqueSlug } from './slug.util.js';

/** Identical for new and already-registered emails, so the endpoint can't be used to probe accounts. */
export const REGISTRATION_ACCEPTED = {
  status: 'pending_verification',
  message: 'Check your email to confirm your address and finish setting up your restaurant.',
} as const;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly app: AppConfig;

  constructor(
    @Inject(BETTER_AUTH) private readonly auth: AuthInstance,
    private readonly authService: AuthService,
    private readonly accounts: AccountAuthService,
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.app = config.getOrThrow<AppConfig>('app');
  }

  /**
   * Owner self sign-up: owner account (unverified) + restaurant + default stations, then a verification email.
   * Sign-in is blocked until the email is verified (requireEmailVerification).
   */
  async register(dto: RegisterDto) {
    if (!this.app.selfSignupEnabled) throw new NotFoundException();

    if (await this.accounts.findUserByEmail(dto.email)) {
      await this.mailer.send(templates.accountExists(dto.email, `${this.app.appUrl}/login`, `${this.app.appUrl}/forgot-password`));
      return REGISTRATION_ACCEPTED;
    }

    const slug = dto.slug ?? (await uniqueSlug(slugify(dto.restaurantName), (s) => this.accounts.slugTaken(s)));
    if (dto.slug && (await this.accounts.slugTaken(dto.slug))) throw new DomainConflictException('That restaurant handle is taken', 'SLUG_TAKEN');

    try {
      // The owner is created unverified: AuthService.createStaff defaults emailVerified to false,
      // and the verification email below is what flips it.
      const { restaurantId, ownerUserId } = await this.authService.provisionRestaurant(
        { restaurantName: dto.restaurantName, slug, ownerName: dto.ownerName, ownerEmail: dto.email, ownerPassword: dto.password },
        createRestaurantForOrganization(this.prisma),
      );
      await this.db.runFor(restaurantId, (tx) =>
        this.audit.record(tx, { action: 'restaurant.register', subjectType: 'restaurant', subjectId: restaurantId, userId: ownerUserId, after: { slug, selfService: true } }),
      );
    } catch (e) {
      // Lost a race with a concurrent sign-up for the same email: same answer as above, nothing leaked.
      if (await this.accounts.findUserByEmail(dto.email)) return REGISTRATION_ACCEPTED;
      throw e;
    }

    await this.auth.api.sendVerificationEmail({ body: { email: dto.email, callbackURL: `${this.app.appUrl}/login?verified=1` } });
    return REGISTRATION_ACCEPTED;
  }

  async slugAvailable(slug: string) {
    return { slug, available: !(await this.accounts.slugTaken(slug)) };
  }

  /** Public preview for the invitation landing page. */
  async previewInvitation(id: string) {
    const inv = await this.accounts.getUsableInvitation(id);
    return {
      restaurantName: await this.accounts.restaurantName(inv.organizationId),
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      accountExists: Boolean(await this.accounts.findUserByEmail(inv.email)),
    };
  }

  /** New person accepts: creates a verified account and the membership. They then sign in normally. */
  async acceptInvitation(id: string, dto: AcceptInvitationDto) {
    const inv = await this.accounts.getUsableInvitation(id);
    const { userId } = await this.accounts.acceptAsNewUser(inv, dto);
    await this.db.runFor(inv.organizationId, (tx) =>
      this.audit.record(tx, { action: 'invitation.accept', subjectType: 'invitation', subjectId: inv.id, userId, after: { role: inv.role, newAccount: true } }),
    );
    return { status: 'accepted', email: inv.email, restaurantId: inv.organizationId, role: inv.role };
  }
}