import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { addDays, businessDateFor } from '../../common/utils/business-date.util.js';
import { DailyRollupService } from '../../modules/reporting/daily-rollup.service.js';
import { RestaurantSettingsService } from '../../modules/settings/restaurant-settings.service.js';
import { QUEUES, type DailyRollupJob } from '../queues.js';
import { TenantJobRunner } from '../tenant-job.runner.js';

/**
 * Scheduled hourly: for each restaurant, (re)computes the PREVIOUS business date in its own timezone.
 * Idempotent upsert, so running hourly is cheap and self-healing. Manual recompute: add a job with { restaurantId, date }.
 */
@Processor(QUEUES.reports)
export class DailyRollupProcessor extends WorkerHost {
  private readonly logger = new Logger(DailyRollupProcessor.name);

  constructor(
    private readonly runner: TenantJobRunner,
    private readonly rollup: DailyRollupService,
    private readonly settings: RestaurantSettingsService,
  ) {
    super();
  }

  async process(job: Job<DailyRollupJob>) {
    const result = await this.runner.forEach(
      (restaurantId) =>
        this.runner.run(restaurantId, async (tx) => {
          const s = await this.settings.get(tx);
          const iso = job.data.date ?? addDays(businessDateFor(new Date(), s.timezone, s.dayRolloverHour).iso, -1);
          await this.rollup.persist(tx, iso);
        }),
      job.data.restaurantId,
    );
    this.logger.log(`daily rollup: ${result.ok} ok, ${result.failed} failed`);
    if (result.failed) throw new Error(`${result.failed} restaurant(s) failed`);
    return result;
  }
}
