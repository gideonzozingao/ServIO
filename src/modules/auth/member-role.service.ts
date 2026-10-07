import { Injectable } from '@nestjs/common';
import { isStaffRole, type StaffRole } from '../../common/types/tx.type.js';
import { AuthPrismaClient } from '../../database/auth-prisma.client.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

const TTL = 60;

/** member role lookup on every request; Redis-cached briefly, invalidated on role change/removal. */
@Injectable()
export class MemberRoleService {
  constructor(
    private readonly authPrisma: AuthPrismaClient,
    private readonly redis: RedisService,
  ) {}

  private key(org: string, user: string) {
    return `member-role:${org}:${user}`;
  }

  async roleOf(organizationId: string, userId: string): Promise<StaffRole | null> {
    const k = this.key(organizationId, userId);
    const cached = await this.redis.client.get(k);
    if (cached) return cached === '-' ? null : (cached as StaffRole);

    const member = await this.authPrisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    const role = member && isStaffRole(member.role) ? member.role : null;
    await this.redis.client.set(k, role ?? '-', 'EX', TTL);
    return role;
  }

  async invalidate(organizationId: string, userId: string): Promise<void> {
    await this.redis.del(this.key(organizationId, userId));
  }
}
