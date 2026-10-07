import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { QUEUES } from '../../jobs/queues.js';
import { HealthController } from './health.controller.js';
import { PrismaHealthIndicator } from './indicators/prisma.indicator.js';
import { QueueHealthIndicator } from './indicators/queue.indicator.js';
import { RedisHealthIndicator } from './indicators/redis.indicator.js';

@Module({
  imports: [TerminusModule, BullModule.registerQueue({ name: QUEUES.notifications })],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
})
export class HealthModule {}
