import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Display names for soft references (waiterId, receivedById, approverId...).
 * Reads Better Auth's `user` table through the app client (read-only; writes are blocked by the guard extension).
 */
@Injectable()
export class StaffDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async namesByIds(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const users = await this.prisma.app.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async nameOf(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await this.namesByIds([id])).get(id) ?? null;
  }
}
