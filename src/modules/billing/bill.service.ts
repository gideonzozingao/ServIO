import { Injectable } from '@nestjs/common';
import {
  DomainConflictException,
  DomainException,
  EntityNotFoundException,
  InvalidStateException,
} from '../../common/exceptions/domain.exceptions.js';
import { percentOf } from '../../common/money/tax.util.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { dbDateToIso } from '../../common/utils/business-date.util.js';
import {
  BillStatus,
  CounterScope,
  type Bill,
  type Order,
} from '../../database/prisma-client.js';
import { DocumentNumberService } from '../../database/document-number.service.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { StaffDirectoryService } from '../staff/staff-directory.service.js';
import { RestaurantSettingsService } from '../settings/restaurant-settings.service.js';
import { TaxService } from './tax.service.js';

@Injectable()
export class BillService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly settings: RestaurantSettingsService,
    private readonly tax: TaxService,
    private readonly directory: StaffDirectoryService,
  ) {}

  /** Freezes the order's totals into a bill. One live (OPEN/PAID) bill per order. */
  async createFromOrder(
    tx: TenantTx,
    order: Order,
    createdById: string,
  ): Promise<Bill> {
    const live = await tx.bill.count({
      where: {
        orderId: order.id,
        status: { in: [BillStatus.OPEN, BillStatus.PAID] },
      },
    });
    if (live)
      throw new DomainConflictException(
        'Order already has a bill',
        'BILL_EXISTS',
      );
    if (order.totalMinor <= 0)
      throw new DomainException('Nothing to bill', 'EMPTY_BILL');

    const bd = await this.settings.businessDate(tx);
    const number = await this.numbers.next(tx, CounterScope.BILL, bd.date);
    return tx.bill.create({
      data: {
        restaurantId: rid(),
        orderId: order.id,
        number,
        businessDate: bd.date,
        subtotalMinor: order.subtotalMinor,
        taxMinor: order.taxMinor,
        discountMinor: order.discountMinor,
        totalMinor: order.totalMinor,
        createdById,
      },
    });
  }

  /** SELECT … FOR UPDATE: serialises concurrent payments/discounts on the same bill. */
  async lock(tx: TenantTx, billId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`;
    if (!rows.length) throw new EntityNotFoundException('Bill', billId);
    const bill = await tx.bill.findFirstOrThrow({
      where: { id: billId },
      include: { payments: true },
    });
    return {
      ...bill,
      paidMinor: bill.payments.reduce((s, p) => s + p.amountMinor, 0),
    };
  }

  /**
   * Discount on the bill subtotal; totals recomputed once and mirrored onto the order.
   * The caller consumes the manager approval and writes the audit row in the same transaction.
   */
  async applyDiscount(
    tx: TenantTx,
    billId: string,
    input: {
      amountMinor?: number;
      percentBps?: number;
      reason: string;
      approverId: string;
    },
  ) {
    const bill = await this.lock(tx, billId);
    if (bill.status !== BillStatus.OPEN)
      throw new InvalidStateException(`Bill is ${bill.status}`);

    const discount =
      input.percentBps !== undefined
        ? percentOf(bill.subtotalMinor, input.percentBps)
        : (input.amountMinor ?? 0);
    if (discount > bill.subtotalMinor)
      throw new DomainException(
        'Discount exceeds the bill subtotal',
        'DISCOUNT_TOO_LARGE',
      );

    const totals = await this.tax.totals(tx, bill.subtotalMinor, discount);
    if (totals.totalMinor < bill.paidMinor)
      throw new DomainException(
        'Discount would make the bill less than what has already been paid',
        'DISCOUNT_BELOW_PAID',
      );

    const updated = await tx.bill.update({
      where: { id: billId },
      data: {
        ...totals,
        discountReason: input.reason,
        discountApprovedById: input.approverId,
      },
    });
    await tx.order.update({ where: { id: bill.orderId }, data: totals });
    return {
      before: bill,
      after: updated,
      balanceMinor: totals.totalMinor - bill.paidMinor,
    };
  }

  async voidOpenBills(tx: TenantTx, orderId: string): Promise<number> {
    const n = await tx.bill.updateMany({
      where: { orderId, status: BillStatus.OPEN },
      data: { status: BillStatus.VOID },
    });
    return n.count;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async get(id: string) {
    const bill = await this.db.run((tx) =>
      tx.bill.findFirst({
        where: { id },
        include: {
          payments: { orderBy: { paidAt: 'asc' } },
          order: {
            include: {
              items: {
                where: { voidedAt: null },
                include: { modifiers: true },
              },
              table: true,
            },
          },
        },
      }),
    );
    if (!bill) throw new EntityNotFoundException('Bill', id);
    const names = await this.directory.namesByIds([
      bill.createdById,
      bill.discountApprovedById,
      ...bill.payments.map((p) => p.receivedById),
    ]);
    const paidMinor = bill.payments.reduce((s, p) => s + p.amountMinor, 0);
    const settings = await this.settings.get();
    return {
      id: bill.id,
      number: bill.number,
      businessDate: dbDateToIso(bill.businessDate),
      status: bill.status,
      currency: settings.currency,
      pricesIncludeTax: settings.pricesIncludeTax,
      order: {
        id: bill.order.id,
        number: bill.order.number,
        table: bill.order.table?.label ?? null,
        type: bill.order.type,
      },
      lines: bill.order.items.map((i) => ({
        name: i.nameSnapshot,
        qty: i.qty,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
        modifiers: i.modifiers.map((m) => ({
          name: m.nameSnapshot,
          priceDeltaMinor: m.priceDeltaMinor,
        })),
      })),
      totals: {
        subtotalMinor: bill.subtotalMinor,
        discountMinor: bill.discountMinor,
        taxMinor: bill.taxMinor,
        totalMinor: bill.totalMinor,
      },
      discount: bill.discountMinor
        ? {
            reason: bill.discountReason,
            approvedBy: names.get(bill.discountApprovedById ?? '') ?? null,
          }
        : null,
      paidMinor,
      balanceMinor: bill.totalMinor - paidMinor,
      payments: bill.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amountMinor: p.amountMinor,
        tenderedMinor: p.tenderedMinor,
        changeMinor: p.tenderedMinor ? p.tenderedMinor - p.amountMinor : 0,
        reference: p.reference,
        receivedBy: names.get(p.receivedById) ?? null,
        paidAt: p.paidAt,
      })),
      createdBy: names.get(bill.createdById) ?? null,
      createdAt: bill.createdAt,
      paidAt: bill.paidAt,
    };
  }

  listForOrder(orderId: string) {
    return this.db.run((tx) =>
      tx.bill.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          number: true,
          status: true,
          totalMinor: true,
          createdAt: true,
          paidAt: true,
        },
      }),
    );
  }
}
