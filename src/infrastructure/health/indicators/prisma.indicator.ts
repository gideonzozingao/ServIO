import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  async check(key = 'database') {
    const i = this.health.check(key);
    try {
      await this.prisma.base.$queryRaw`SELECT 1`;
      return i.up();
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
