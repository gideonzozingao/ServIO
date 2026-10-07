import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { BillService } from './bill.service.js';
import { BillsController } from './bills.controller.js';
import { PaymentService } from './payment.service.js';
import { TaxService } from './tax.service.js';

@Module({
  imports: [SettingsModule, StaffModule],
  controllers: [BillsController],
  providers: [BillService, PaymentService, TaxService],
  exports: [BillService, PaymentService, TaxService],
})
export class BillingModule {}
