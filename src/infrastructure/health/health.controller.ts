import { Public } from './../../common/decorators/public/public.decorator.js';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { PrismaHealthIndicator } from './indicators/prisma.indicator.js';
import { QueueHealthIndicator } from './indicators/queue.indicator.js';
import { RedisHealthIndicator } from './indicators/redis.indicator.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly queue: QueueHealthIndicator,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.db.check(), () => this.redis.check(), () => this.queue.check()]);
  }
}
