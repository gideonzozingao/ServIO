import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApprovalToken,RequiresApproval } from './../../../common/decorators/requires-approval/requires-approval.decorator.js';
import { RequirePermission } from './../../../common/decorators/require-permission/require-permission.decorator.js';

import { CurrentSession } from './../../../common/decorators/current-session/current-session.decorator.js';

import type { RequestSession } from '../../../common/types/tx.type.js';
import { VoidDto } from '../dto/order-flow.dto.js';
import { CreateBillUseCase } from '../use-cases/create-bill.use-case.js';
import { SendOrderUseCase } from '../use-cases/send-order.use-case.js';
import { ServeOrderUseCase } from '../use-cases/serve-order.use-case.js';
import { VoidItemUseCase } from '../use-cases/void-item.use-case.js';
import { VoidOrderUseCase } from '../use-cases/void-order.use-case.js';

@ApiTags('order-flow')
@Controller('orders/:id')
export class OrderActionsController {
  constructor(
    private readonly send: SendOrderUseCase,
    private readonly serve: ServeOrderUseCase,
    private readonly bill: CreateBillUseCase,
    private readonly voidOrder: VoidOrderUseCase,
    private readonly voidItem: VoidItemUseCase,
  ) {}

  @Post('send') @HttpCode(200)
  @RequirePermission('order', 'update')
  sendOrder(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.send.execute(s, id);
  }

  @Post('serve') @HttpCode(200)
  @RequirePermission('order', 'update')
  serveOrder(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.serve.execute(s, id);
  }

  @Post('bill')
  @RequirePermission('bill', 'create')
  createBill(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.bill.execute(s, id);
  }

  @Post('void') @HttpCode(200)
  @RequirePermission('order', 'void')
  @RequiresApproval('order.void')
  void(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto, @ApprovalToken() token?: string) {
    return this.voidOrder.execute(s, id, dto.reason, token);
  }

  /** Approval required only if the item was already sent (enforced in the use case). */
  @Post('items/:itemId/void') @HttpCode(200)
  @RequirePermission('order', 'update')
  @ApiHeader({ name: 'X-Approval-Token', required: false })
  voidLine(
    @CurrentSession() s: RequestSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: VoidDto,
    @ApprovalToken() token?: string,
  ) {
    return this.voidItem.execute(s, id, itemId, dto.reason, token);
  }
}
