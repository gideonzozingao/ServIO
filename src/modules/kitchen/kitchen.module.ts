import { TicketService } from './kitchen.service.js';
import { Module } from '@nestjs/common';
import { KitchenTicketsController } from './kitchen-tickets.controller.js';
import { TicketQueryService } from './ticket-query.service.js';
import { TicketStateMachine } from './ticket-state-machine.js';


@Module({
  controllers: [KitchenTicketsController],
  providers: [TicketService, TicketQueryService, TicketStateMachine],
  exports: [TicketService, TicketQueryService],
})
export class KitchenModule {}
