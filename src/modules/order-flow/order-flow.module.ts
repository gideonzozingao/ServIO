import { OrderActionsController } from './contollers/order-actions.controller.js';
import { KitchenActionsController } from './contollers/kitchen-actions.controller.js';
import { BillActionsController } from './contollers/bill-actions.controller.js';
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FloorModule } from '../floor/floor.module.js';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { OrdersModule } from '../orders/orders.module.js';

import { OrderRollupService } from './order-rollup.service.js';
import { AdvanceTicketUseCase } from './use-cases/advance-ticket.use-case.js';
import { ApplyDiscountUseCase } from './use-cases/apply-discount.use-case.js';
import { CreateBillUseCase } from './use-cases/create-bill.use-case.js';
import { RecordPaymentUseCase } from './use-cases/record-payment.use-case.js';
import { SendOrderUseCase } from './use-cases/send-order.use-case.js';
import { ServeOrderUseCase } from './use-cases/serve-order.use-case.js';
import { VoidItemUseCase } from './use-cases/void-item.use-case.js';
import { VoidOrderUseCase } from './use-cases/void-order.use-case.js';

/** Sits above orders/kitchen/billing/floor and orchestrates them; nothing imports this module. */
@Module({
  imports: [OrdersModule, KitchenModule, BillingModule, FloorModule, CatalogModule],
  controllers: [OrderActionsController, KitchenActionsController, BillActionsController],
  providers: [
    OrderRollupService,
    SendOrderUseCase, AdvanceTicketUseCase, ServeOrderUseCase, CreateBillUseCase,
    RecordPaymentUseCase, ApplyDiscountUseCase, VoidOrderUseCase, VoidItemUseCase,
  ],
})
export class OrderFlowModule {}
