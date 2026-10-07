import { SessionUser } from './../../common/decorators/session-only/session-only.decorator.js';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AppConfig } from '../../config/configuration.js';

import { DomainException } from '../../common/exceptions/domain.exceptions.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import {
  AccountAuthService,
  isPinOnlyEmail,
} from '../auth/account-auth.service.js';
import { permissionsFor } from '../auth/access-control.js';
import { BETTER_AUTH, type AuthInstance } from '../auth/auth.config.js';
import { isStaffRole } from '../../common/types/tx.type.js';
import type {
  ChangeEmailDto,
  ChangePasswordDto,
  UpdateAccountDto,
} from './dto/accounts.dto.js';

/** Copies Set-Cookie from a server-side auth.api call (e.g. new session after a password change) onto our response. */
function forwardCookies(res: Response, headers: Headers | undefined) {
  const cookies = headers?.getSetCookie?.() ?? [];
  if (cookies.length) res.append('Set-Cookie', cookies);
}

@Injectable()
export class AccountService {
  private readonly appUrl: string;

  constructor(
    @Inject(BETTER_AUTH) private readonly auth: AuthInstance,
    private readonly accounts: AccountAuthService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.appUrl = config.getOrThrow<AppConfig>('app').appUrl;
  }

  async get(u: SessionUser) {
    const memberships = await this.accounts.memberships(u.userId);
    const pinOnly = isPinOnlyEmail(u.email);
    return {
      user: {
        id: u.userId,
        name: u.name,
        email: pinOnly ? null : u.email,
        emailVerified: u.emailVerified,
        pinOnly,
      },
      activeRestaurantId: u.activeRestaurantId,
      restaurants: memberships.map((m) => ({
        restaurantId: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        logo: m.organization.logo,
        role: m.role,
        permissions: isStaffRole(m.role) ? permissionsFor(m.role) : [],
        active: m.organization.id === u.activeRestaurantId,
      })),
    };
  }

  async update(u: SessionUser, dto: UpdateAccountDto, headers: Headers) {
    await this.auth.api.updateUser({
      headers,
      body: { name: dto.name, image: dto.image },
    });
    return this.get({ ...u, name: dto.name ?? u.name });
  }

  async changePassword(
    u: SessionUser,
    dto: ChangePasswordDto,
    headers: Headers,
    res: Response,
  ) {
    this.assertEmailAccount(u);
    const result = await this.auth.api.changePassword({
      headers,
      body: {
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
        revokeOtherSessions: dto.revokeOtherSessions ?? true,
      },
      returnHeaders: true,
    });
    forwardCookies(res, result.headers); // revoking other sessions issues a fresh session for this device
    await this.auditPersonal(u, 'account.password_change', {
      revokedOthers: dto.revokeOtherSessions ?? true,
    });
    return {
      status: 'changed',
      token: (result.response as { token?: string | null }).token ?? null,
    };
  }

  async changeEmail(u: SessionUser, dto: ChangeEmailDto, headers: Headers) {
    this.assertEmailAccount(u);
    await this.auth.api.changeEmail({
      headers,
      body: {
        newEmail: dto.newEmail,
        callbackURL: `${this.appUrl}/account?emailChanged=1`,
      },
    });
    await this.auditPersonal(u, 'account.email_change_requested', {
      newEmail: dto.newEmail,
    });
    return {
      status: 'confirmation_sent',
      message:
        'Approve the change from the link sent to your current email address.',
    };
  }

  async sessions(u: SessionUser) {
    return (await this.accounts.listSessions(u.userId)).map((s) => ({
      ...s,
      current: s.id === u.sessionId,
      viaDevice: s.deviceId !== null,
    }));
  }

  async revokeSession(u: SessionUser, id: string) {
    if (id === u.sessionId)
      throw new DomainException(
        'Use sign-out to end the current session',
        'CURRENT_SESSION',
      );
    await this.accounts.revokeSession(u.userId, id);
  }

  async revokeOthers(u: SessionUser) {
    return {
      revoked: await this.accounts.revokeOtherSessions(u.userId, u.sessionId),
    };
  }

  async setActiveRestaurant(u: SessionUser, restaurantId: string) {
    const role = await this.accounts.setActiveRestaurant(
      u.userId,
      await this.accounts.sessionToken(u.sessionId),
      restaurantId,
    );
    return { restaurantId, role };
  }

  // ── Invitations addressed to me ───────────────────────────────────────────

  async myInvitations(u: SessionUser) {
    if (!u.emailVerified || isPinOnlyEmail(u.email)) return [];
    const rows = await this.accounts.pendingInvitationsFor(u.email);
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        restaurantName: await this.accounts.restaurantName(r.organizationId),
        role: r.role,
        expiresAt: r.expiresAt,
      })),
    );
  }

  async acceptInvitation(u: SessionUser, id: string) {
    const inv = await this.accounts.getUsableInvitation(id);
    await this.accounts.acceptAsExistingUser(inv, {
      id: u.userId,
      email: u.email,
      emailVerified: u.emailVerified,
    });
    await this.db.runFor(inv.organizationId, (tx) =>
      this.audit.record(tx, {
        action: 'invitation.accept',
        subjectType: 'invitation',
        subjectId: inv.id,
        userId: u.userId,
        after: { role: inv.role, newAccount: false },
      }),
    );
    return {
      status: 'accepted',
      restaurantId: inv.organizationId,
      role: inv.role,
    };
  }

  async rejectInvitation(u: SessionUser, id: string) {
    const inv = await this.accounts.getUsableInvitation(id);
    if (inv.email !== u.email.toLowerCase())
      throw new DomainException(
        'This invitation was sent to a different email address',
        'INVITATION_EMAIL_MISMATCH',
        403,
      );
    await this.accounts.setInvitationStatus(id, 'pending', 'rejected');
  }

  private assertEmailAccount(u: SessionUser) {
    if (isPinOnlyEmail(u.email))
      throw new DomainException(
        'PIN-only staff accounts have no email or password',
        'PIN_ONLY_ACCOUNT',
      );
  }

  /** Personal actions are logged in the active restaurant's audit trail when there is one. */
  private async auditPersonal(
    u: SessionUser,
    action: string,
    after: Record<string, unknown>,
  ) {
    if (!u.activeRestaurantId) return;
    await this.db.runFor(u.activeRestaurantId, (tx) =>
      this.audit.record(tx, {
        action,
        subjectType: 'user',
        subjectId: u.userId,
        userId: u.userId,
        after: after as never,
      }),
    );
  }
}
