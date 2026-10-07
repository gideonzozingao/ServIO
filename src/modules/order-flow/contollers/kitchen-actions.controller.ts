import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession } from './../../../common/decorators/current-session/current-session.decorator.js';
import { RequirePermission } from './../../../common/decorators/require-permission/require-permission.decorator.js';
import type { RequestSession } from '../../../common/types/tx.type.js';
import { AdvanceTicketDto } from '../../kitchen/dto/ticket.dto.js';
import { AdvanceTicketUseCase } from '../use-cases/advance-ticket.use-case.js';

@ApiTags('kitchen')
@Controller('kitchen-tickets')
export class KitchenActionsController {
  constructor(private readonly advance: AdvanceTicketUseCase) {}

  @Patch(':id')
  @RequirePermission('ticket', 'update')
  update(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceTicketDto) {
    return this.advance.execute(s, id, dto.status);
  }
}
