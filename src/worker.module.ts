import { Module } from '@nestjs/common';
import { CORE_IMPORTS } from './app.module.js';
import { JobsModule } from './jobs/jobs.module.js';

/** Worker container: same DB/auth/tenancy setup, BullMQ processors, no HTTP. */
@Module({ imports: [...CORE_IMPORTS, JobsModule] })
export class WorkerModule {}
