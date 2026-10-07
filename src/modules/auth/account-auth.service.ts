import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from 'better-auth';
import { DomainConflictException, DomainException } from '../../common/exceptions/domain.exceptions.js';
import type { StaffRole } from '../../common/types/tx.type.js';
import { AuthPrismaClient } from '../../database/auth-prisma.client.js';
import { BETTER_AUTH, type AuthInstance } from './auth.config.js';
import { PLACEHOLDER_EMAIL_DOMAIN } from './auth.service.js';
import { MemberRoleService } from './member-role.service.js';

export const INVITABLE_ROLES = ['owner', 'manager'] as const satisfies readonly StaffRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export const INVITATION_TTL_DAYS = 7;

export interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  expiresAt: Date;
  inviterId: string;
  createdAt?: Date;
}

export const isPinOnlyEmail = (email: string) => email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

/**
 * Account-level writes to Better Auth tables (invitations, memberships, sessions) for the accounts module.
 * Invitations reuse Better Auth's `invitation` table; the invitation id (UUIDv4, 122 random bits) is the link token,
 * as in Better Auth's own flow.
 */
@Injectable()
export class AccountAuthService {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: AuthInstance,
    private readonly authPrisma: AuthPrismaClient,
    private readonly members: MemberRoleService,
  ) {}

  private async ctx(): Promise<AuthContext> {
    return (await this.auth.$context) as unknown as AuthContext;
  }

  // ── Lookups ─────────────────────────────────────────────────────────────

  findUserByEmail(email: string) {
    return this.authPrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  slugTaken(slug: string) {
    return this.authPrisma.organization.findUnique({ where: { slug } }).then(Boolean);
  }

  memberships(userId: string) {
    return this.authPrisma.member.findMany({
      where: { userId },
      include: { organization: { select: { id: true, name: true, slug: true, logo: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  restaurantName(organizationId: string) {
    return this.authPrisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).then((o) => o?.name ?? 'your restaurant');
  }

  // ── Invitations ──────────────────────────────────────────────────────────

  async createInvitation(input: { organizationId: string; email: string; role: InvitableRole; inviterId: string }) {
    const email = input.email.toLowerCase();
    if (isPinOnlyEmail(email)) throw new BadRequestException('Invalid email');

    const existingUser = await this.findUserByEmail(email);
    if (existingUser) {
      const member = await this.authPrisma.member.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId: existingUser.id } } });
      if (member) throw new DomainConflictException('This person is already a member of the restaurant', 'ALREADY_MEMBER');
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
    const pending = await this.authPrisma.invitation.findFirst({ where: { organizationId: input.organizationId, email, status: 'pending' } });
    const ctx = await this.ctx();
    if (pending) {
      // Re-inviting refreshes the existing invitation (same link) and updates the role.
      return ctx.adapter.update<InvitationRow>({
        model: 'invitation', where: [{ field: 'id', value: pending.id }],
        update: { role: input.role, expiresAt, inviterId: input.inviterId },
      }) as Promise<InvitationRow>;
    }
    return ctx.adapter.create<Omit<InvitationRow, 'id'>, InvitationRow>({
      model: 'invitation',
      data: { organizationId: input.organizationId, email, role: input.role, status: 'pending', expiresAt, inviterId: input.inviterId, createdAt: new Date() },
    });
  }

  pendingInvitationsFor(email: string) {
    return this.authPrisma.invitation.findMany({ where: { email: email.toLowerCase(), status: 'pending', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  }

  listInvitations(organizationId: string, status?: InvitationRow['status']) {
    return this.authPrisma.invitation.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } });
  }

  async getInvitation(id: string, organizationId?: string): Promise<InvitationRow> {
    const inv = await this.authPrisma.invitation.findFirst({ where: { id, ...(organizationId ? { organizationId } : {}) } });
    if (!inv) throw new NotFoundException('Invitation not found');
    return inv as InvitationRow;
  }

  /** Pending and unexpired, else a precise error the UI can show. */
  async getUsableInvitation(id: string): Promise<InvitationRow> {
    const inv = await this.getInvitation(id);
    if (inv.status !== 'pending') throw new DomainException(`Invitation is ${inv.status}`, 'INVITATION_CLOSED', 410);
    if (inv.expiresAt.getTime() < Date.now()) throw new DomainException('Invitation has expired', 'INVITATION_EXPIRED', 410);
    return inv;
  }

  async refreshInvitation(id: string, organizationId: string) {
    const inv = await this.getInvitation(id, organizationId);
    if (inv.status !== 'pending') throw new DomainException(`Invitation is ${inv.status}`, 'INVITATION_CLOSED', 410);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
    await (await this.ctx()).adapter.update({ model: 'invitation', where: [{ field: 'id', value: id }], update: { expiresAt } });
    return { ...inv, expiresAt };
  }

  async setInvitationStatus(id: string, from: 'pending', to: InvitationRow['status']) {
    // Conditional update = race-safe single use.
    const n = await (await this.ctx()).adapter.updateMany({
      model: 'invitation', where: [{ field: 'id', value: id }, { field: 'status', value: from }], update: { status: to },
    });
    if (n !== 1) throw new DomainException('Invitation is no longer pending', 'INVITATION_CLOSED', 410);
  }

  /**
   * New person: the link proves they control the inbox, so the account is created already verified.
   * Compensates (deletes the new user) if joining fails.
   */
  async acceptAsNewUser(inv: InvitationRow, input: { name: string; password: string }) {
    if (await this.findUserByEmail(inv.email)) {
      throw new DomainConflictException('An account with this email already exists. Sign in and accept from your account.', 'ACCOUNT_EXISTS');
    }
    const ctx = await this.ctx();
    if (input.password.length < 10) throw new BadRequestException('Password must be at least 10 characters');
    await this.setInvitationStatus(inv.id, 'pending', 'accepted');
    const user = await ctx.internalAdapter.createUser({ email: inv.email, name: input.name, emailVerified: true }, { method: 'email-password' });
    try {
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(input.password) });
      await this.addMember(inv.organizationId, user.id, inv.role ?? 'manager');
    } catch (e) {
      await this.authPrisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      await this.authPrisma.invitation.update({ where: { id: inv.id }, data: { status: 'pending' } }).catch(() => undefined);
      throw e;
    }
    return { userId: user.id };
  }

  /** Existing account (e.g. owner of another branch): must be signed in with the invited, verified email. */
  async acceptAsExistingUser(inv: InvitationRow, user: { id: string; email: string; emailVerified: boolean }) {
    if (user.email.toLowerCase() !== inv.email) throw new DomainException('This invitation was sent to a different email address', 'INVITATION_EMAIL_MISMATCH', 403);
    if (!user.emailVerified) throw new DomainException('Verify your email first', 'EMAIL_NOT_VERIFIED', 403);
    const existing = await this.authPrisma.member.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } } });
    await this.setInvitationStatus(inv.id, 'pending', 'accepted');
    if (!existing) await this.addMember(inv.organizationId, user.id, inv.role ?? 'manager');
  }

  private async addMember(organizationId: string, userId: string, role: string) {
    await (await this.ctx()).adapter.create({ model: 'member', data: { organizationId, userId, role, createdAt: new Date() } });
    await this.members.invalidate(organizationId, userId);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  listSessions(userId: string) {
    return this.authPrisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true, deviceId: true, activeOrganizationId: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Through the internal adapter so the Redis (secondaryStorage) copy is removed too. */
  async revokeSession(userId: string, sessionId: string) {
    const s = await this.authPrisma.session.findFirst({ where: { id: sessionId, userId }, select: { token: true } });
    if (!s) throw new NotFoundException('Session not found');
    await (await this.ctx()).internalAdapter.deleteSession(s.token);
  }

  async revokeOtherSessions(userId: string, keepSessionId: string) {
    const rows = await this.authPrisma.session.findMany({ where: { userId, id: { not: keepSessionId } }, select: { token: true } });
    if (rows.length) await (await this.ctx()).internalAdapter.deleteSessions(rows.map((r) => r.token));
    return rows.length;
  }

  /** Switch restaurant: membership checked here, then the session row (and its Redis copy) is updated. */
  async setActiveRestaurant(userId: string, sessionToken: string, organizationId: string) {
    const member = await this.authPrisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!member) throw new DomainException('Not a member of this restaurant', 'NOT_A_MEMBER', 403);
    await (await this.ctx()).internalAdapter.updateSession(sessionToken, { activeOrganizationId: organizationId });
    return member.role;
  }

  async sessionToken(sessionId: string) {
    const s = await this.authPrisma.session.findUnique({ where: { id: sessionId }, select: { token: true } });
    if (!s) throw new NotFoundException('Session not found');
    return s.token;
  }
}
