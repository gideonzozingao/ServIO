import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { DailyRollupService } from './daily-rollup.service.js';
import { ReportCacheListener } from './report-cache.listener.js';
import { ReportQueryService } from './report-query.service.js';
import { ReportsController } from './reports.controller.js';

@Module({
  imports: [SettingsModule, StaffModule],
  controllers: [ReportsController],
  providers: [ReportQueryService, DailyRollupService, ReportCacheListener],
  exports: [DailyRollupService],
})
export class ReportingModule {}
