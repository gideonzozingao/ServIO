import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  controllers: [StaffController, DevicesController],
  providers: [StaffService, StaffDirectoryService],
  exports: [StaffDirectoryService],
})
export class StaffModule {}
