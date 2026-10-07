import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service.js';
import { QUEUES } from '../queues.js';
import { TenantJobRunner } from '../tenant-job.runner.js';

@Processor(QUEUES.maintenance)
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);

  constructor(private readonly runner: TenantJobRunner, private readonly auth: AuthService) {
    super();
  }

  async process() {
    let keys = 0;
    await this.runner.forEach((restaurantId) =>
      this.runner.run(restaurantId, async (tx) => {
        keys += (await tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
      }),
    );
    const auth = await this.auth.cleanupExpired();
    this.logger.log(`cleanup: ${keys} idempotency keys, ${auth.sessions} sessions, ${auth.approvals} approvals`);
    return { idempotencyKeys: keys, ...auth };
  }
}
