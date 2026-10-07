import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { cursorArgs } from '../../common/dto/pagination.dto.js';
import { paginate } from '../../common/dto/paginated-response.dto.js';
// import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
// import RequirePermission
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: TenantPrismaService) {}

  @Get()
  @RequirePermission('report', 'read')
  async list(@Query() q: AuditQueryDto) {
    const rows = await this.db.run((tx) =>
      tx.auditLog.findMany({
        where: {
          action: q.action,
          subjectType: q.subjectType,
          subjectId: q.subjectId,
          userId: q.userId,
          createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined } : undefined,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q),
      }),
    );
    return paginate(rows, q.limit);
  }
}
