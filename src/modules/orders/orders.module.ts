import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FloorModule } from '../floor/floor.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { OrderPricingService } from './order-pricing.service.js';
import { OrderQueryService } from './order-query.service.js';
import { OrderStateMachine } from './order-state-machine.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [CatalogModule, FloorModule, SettingsModule, StaffModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPricingService, OrderQueryService, OrderStateMachine],
  exports: [OrdersService, OrderPricingService, OrderQueryService, OrderStateMachine],
})
export class OrdersModule {}
