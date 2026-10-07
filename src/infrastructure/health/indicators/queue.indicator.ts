import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../jobs/queues.js';

const BACKLOG_LIMIT = 1000;

@Injectable()
export class QueueHealthIndicator {
  constructor(
    @InjectQueue(QUEUES.notifications) private readonly queue: Queue,
    private readonly health: HealthIndicatorService,
  ) {}

  async check(key = 'queue') {
    const i = this.health.check(key);
    try {
      const counts = await this.queue.getJobCounts('waiting', 'delayed', 'failed');
      const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0);
      return backlog < BACKLOG_LIMIT ? i.up(counts) : i.down({ ...counts, message: 'backlog' });
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
