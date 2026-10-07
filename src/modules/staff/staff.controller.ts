import { CurrentSession } from './../../common/decorators/current-session/current-session.decorator.js';
import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
// import { CurrentSession } from '../../common/decorators/current-session.decorator.js';

import type { RequestSession } from '../../common/types/tx.type.js';
import { CreateStaffDto, SetPinDto, UpdateStaffDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('report', 'read') // owner + manager can view the roster
  list(@CurrentSession() s: RequestSession) {
    return this.staff.list(s);
  }

  @Post()
  @RequirePermission('staff', 'manage')
  create(@CurrentSession() s: RequestSession, @Body() dto: CreateStaffDto) {
    return this.staff.create(s, dto);
  }

  @Patch(':userId')
  @RequirePermission('staff', 'manage')
  @HttpCode(204)
  update(
    @CurrentSession() s: RequestSession,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(s, userId, dto);
  }

  @Delete(':userId')
  @RequirePermission('staff', 'manage')
  @HttpCode(204)
  deactivate(
    @CurrentSession() s: RequestSession,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.staff.deactivate(s, userId);
  }

  /** Owner, or manager for floor staff (checked in the service). */
  @Put(':userId/pin')
  @RequirePermission('report', 'read')
  @HttpCode(204)
  setPin(
    @CurrentSession() s: RequestSession,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPinDto,
  ) {
    return this.staff.setPin(s, userId, dto.pin);
  }
}
