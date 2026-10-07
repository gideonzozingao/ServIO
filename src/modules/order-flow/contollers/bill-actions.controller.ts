import { ApprovalToken,RequiresApproval } from './../../../common/decorators/requires-approval/requires-approval.decorator.js';
import { RequirePermission } from './../../../common/decorators/require-permission/require-permission.decorator.js';
import { Idempotent } from './../../../common/decorators/idempotent/idempotent.decorator.js';
import { CurrentSession } from './../../../common/decorators/current-session/current-session.decorator.js';

import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
// import { CurrentSession } from '../../../common/decorators/current-session.decorator.js';

import type { RequestSession } from '../../../common/types/tx.type.js';
import { ApplyDiscountDto, RecordPaymentDto } from '../../billing/dto/billing.dto.js';
import { ApplyDiscountUseCase } from '../use-cases/apply-discount.use-case.js';
import { RecordPaymentUseCase } from '../use-cases/record-payment.use-case.js';

@ApiTags('billing')
@Controller('bills/:id')
export class BillActionsController {
  constructor(private readonly pay: RecordPaymentUseCase, private readonly discount: ApplyDiscountUseCase) {}

  @Post('payments')
  @RequirePermission('bill', 'pay')
  @Idempotent('POST /bills/:id/payments')
  recordPayment(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.pay.execute(s, id, dto);
  }

  @Post('discount')
  @RequirePermission('bill', 'discount')
  @RequiresApproval('bill.discount')
  applyDiscount(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyDiscountDto, @ApprovalToken() token?: string) {
    return this.discount.execute(s, id, dto, token);
  }
}
