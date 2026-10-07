import { CurrentSession } from './../../common/decorators/current-session/current-session.decorator.js';
import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
// import { CurrentSession } from './../../common/decorators/current-session.decorator.js';
// import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';

import type { RequestSession } from '../../common/types/tx.type.js';
import { RegisterDeviceDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@ApiTags('devices')
@Controller('devices')
@RequirePermission('staff', 'manage')
export class DevicesController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentSession() s: RequestSession) {
    return this.staff.listDevices(s);
  }

  /** Returns `deviceToken` ONCE; enter/scan it on the device (stored in SecureStore / localStorage). */
  @Post()
  register(
    @CurrentSession() s: RequestSession,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.staff.registerDevice(s, dto.name);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  revoke(
    @CurrentSession() s: RequestSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staff.revokeDevice(s, id);
  }
}
