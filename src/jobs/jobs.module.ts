import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ReportingModule } from '../modules/reporting/reporting.module.js';
import { SettingsModule } from '../modules/settings/settings.module.js';
import { CleanupProcessor } from './processors/cleanup.processor.js';
import { DailyRollupProcessor } from './processors/daily-rollup.processor.js';
import {
  LogPushSender,
  PUSH_SENDER,
  PushProcessor,
} from './processors/push.processor.js';
import { JOBS, QUEUES } from './queues.js';
import { TenantJobRunner } from './tenant-job.runner.js';

/** Imported by WorkerModule only. Job schedulers are idempotent (upsert), safe on every worker start. */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.reports },
      { name: QUEUES.maintenance },
      { name: QUEUES.notifications },
    ),
    ReportingModule,
    SettingsModule,
  ],
  providers: [
    TenantJobRunner,
    DailyRollupProcessor,
    CleanupProcessor,
    PushProcessor,
    { provide: PUSH_SENDER, useClass: LogPushSender },
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUES.reports) private readonly reports: Queue,
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
  ) {}

  async onModuleInit() {
    await this.reports.upsertJobScheduler(
      'daily-rollup-hourly',
      { pattern: '5 * * * *' },
      { name: JOBS.dailyRollup, data: {} },
    );
    await this.maintenance.upsertJobScheduler(
      'cleanup-30m',
      { every: 30 * 60_000 },
      { name: JOBS.cleanup, data: {} },
    );
  }
}
