import { Injectable } from '@nestjs/common';
import {
  DomainException,
  InvalidStateException,
} from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { BillStatus, PaymentMethod } from '../../database/prisma-client.js';
import { rid } from '../../database/tenant-scope.js';
import { BillService } from './bill.service.js';
import type { RecordPaymentDto } from './dto/billing.dto.js';

export interface PaymentResult {
  paymentId: string;
  billId: string;
  orderId: string;
  amountMinor: number;
  changeMinor: number;
  balanceMinor: number;
  paidInFull: boolean;
}

/** Split payments on one bill (cash + card + mobile money). Bill locked for the whole check-and-insert. */
@Injectable()
export class PaymentService {
  constructor(private readonly bills: BillService) {}

  async record(
    tx: TenantTx,
    billId: string,
    dto: RecordPaymentDto,
    receivedById: string,
  ): Promise<PaymentResult> {
    const bill = await this.bills.lock(tx, billId);
    if (bill.status !== BillStatus.OPEN)
      throw new InvalidStateException(`Bill is ${bill.status}`);

    const remaining = bill.totalMinor - bill.paidMinor;
    if (dto.amountMinor > remaining) {
      throw new DomainException(
        'Payment exceeds the remaining balance',
        'OVERPAYMENT',
        422,
        { remainingMinor: remaining },
      );
    }

    let changeMinor = 0;
    if (dto.method === PaymentMethod.CASH) {
      const tendered = dto.tenderedMinor ?? dto.amountMinor;
      if (tendered < dto.amountMinor)
        throw new DomainException(
          'Cash tendered is less than the amount',
          'TENDER_SHORT',
        );
      changeMinor = tendered - dto.amountMinor;
    } else if (
      dto.tenderedMinor !== undefined &&
      dto.tenderedMinor !== dto.amountMinor
    ) {
      throw new DomainException(
        'Tendered amount only applies to cash',
        'TENDER_NOT_CASH',
      );
    }

    const payment = await tx.payment.create({
      data: {
        restaurantId: rid(),
        billId,
        method: dto.method,
        amountMinor: dto.amountMinor,
        tenderedMinor:
          dto.method === PaymentMethod.CASH
            ? (dto.tenderedMinor ?? dto.amountMinor)
            : null,
        reference: dto.reference,
        receivedById,
      },
    });

    const balanceMinor = remaining - dto.amountMinor;
    if (balanceMinor === 0) {
      await tx.bill.update({
        where: { id: billId },
        data: { status: BillStatus.PAID, paidAt: new Date() },
      });
    }
    return {
      paymentId: payment.id,
      billId,
      orderId: bill.orderId,
      amountMinor: dto.amountMinor,
      changeMinor,
      balanceMinor,
      paidInFull: balanceMinor === 0,
    };
  }
}
