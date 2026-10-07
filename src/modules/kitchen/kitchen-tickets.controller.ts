import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TicketBoardQueryDto } from './dto/ticket.dto.js';
import { TicketQueryService } from './ticket-query.service.js';


/** Reads only. Status changes go through order-flow (PATCH /kitchen-tickets/:id) because they roll up to the order. */
@ApiTags('kitchen')
@Controller('kitchen-tickets')
@RequirePermission('ticket', 'read')
export class KitchenTicketsController {
  constructor(private readonly tickets: TicketQueryService) {}

  @Get()
  board(@Query() q: TicketBoardQueryDto) {
    return this.tickets.board(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(id);
  }
}
