import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
// import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { BillService } from './bill.service.js';

/** Reads only; bill/payment/discount writes are order-flow use cases. */
@ApiTags('billing')
@Controller()
@RequirePermission('bill', 'create')
export class BillsController {
  constructor(private readonly bills: BillService) {}

  @Get('bills/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.get(id);
  }

  @Get('orders/:id/bills')
  forOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.bills.listForOrder(id);
  }
}
