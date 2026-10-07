import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import type { RequestSession } from '../../common/types/tx.type.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import { templates } from '../../infrastructure/mail/mail.templates.js';
import { MailerService } from '../../infrastructure/mail/mailer.service.js';
import { AccountAuthService, type InvitationRow } from '../auth/account-auth.service.js';
import { StaffDirectoryService } from '../staff/staff-directory.service.js';
import type { CreateInvitationDto } from './dto/accounts.dto.js';

@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    private readonly accounts: AccountAuthService,
    private readonly directory: StaffDirectoryService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.appUrl = config.getOrThrow<AppConfig>('app').appUrl;
  }

  link(id: string) {
    return `${this.appUrl}/invite/${id}`;
  }

  async invite(s: RequestSession, dto: CreateInvitationDto) {
    const inv = await this.accounts.createInvitation({ organizationId: s.restaurantId, email: dto.email, role: dto.role, inviterId: s.userId });
    await this.send(s, inv);
    await this.db.run((tx) => this.audit.record(tx, { action: 'invitation.create', subjectType: 'invitation', subjectId: inv.id, after: { email: inv.email, role: inv.role } }));
    return this.present(inv);
  }

  async list(s: RequestSession, status?: InvitationRow['status']) {
    const rows = (await this.accounts.listInvitations(s.restaurantId, status)) as InvitationRow[];
    const names = await this.directory.namesByIds(rows.map((r) => r.inviterId));
    return rows.map((r) => ({ ...this.present(r), invitedBy: names.get(r.inviterId) ?? null }));
  }

  async resend(s: RequestSession, id: string) {
    const inv = await this.accounts.refreshInvitation(id, s.restaurantId);
    await this.send(s, inv);
    return this.present(inv);
  }

  async cancel(s: RequestSession, id: string) {
    await this.accounts.getInvitation(id, s.restaurantId); // tenant check
    await this.accounts.setInvitationStatus(id, 'pending', 'canceled');
    await this.db.run((tx) => this.audit.record(tx, { action: 'invitation.cancel', subjectType: 'invitation', subjectId: id }));
  }

  private async send(s: RequestSession, inv: InvitationRow) {
    const [restaurant, inviter] = await Promise.all([this.accounts.restaurantName(s.restaurantId), this.directory.nameOf(s.userId)]);
    await this.mailer.send(templates.invitation(inv.email, restaurant, inv.role ?? 'manager', inviter ?? 'Your team', this.link(inv.id)));
  }

  /** The id is the bearer link token: only returned to staff managers, never to other roles. */
  private present(inv: InvitationRow) {
    const expired = inv.status === 'pending' && inv.expiresAt.getTime() < Date.now();
    return { id: inv.id, email: inv.email, role: inv.role, status: expired ? 'expired' : inv.status, expiresAt: inv.expiresAt, link: this.link(inv.id) };
  }
}
