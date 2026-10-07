import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  DailyReportQueryDto,
  RangeReportQueryDto,
} from './dto/report-query.dto.js';
import { ReportQueryService } from './report-query.service.js';

@ApiTags('reports')
@Controller('reports')
@RequirePermission('report', 'read')
export class ReportsController {
  constructor(private readonly reports: ReportQueryService) {}

  @Get('daily') daily(@Query() q: DailyReportQueryDto) {
    return this.reports.daily(q.date);
  }
  @Get('top-items') topItems(@Query() q: RangeReportQueryDto) {
    return this.reports.topItems(q.from, q.to, q.limit);
  }
  @Get('staff') staff(@Query() q: RangeReportQueryDto) {
    return this.reports.staff(q.from, q.to);
  }
  @Get('voids') voids(@Query() q: RangeReportQueryDto) {
    return this.reports.voids(q.from, q.to);
  }
}
