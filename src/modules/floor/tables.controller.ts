import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CreateTableDto,
  SetTableStatusDto,
  UpdateTableDto,
} from './dto/floor.dto.js';
import { FloorService } from './floor.service.js';

@ApiTags('floor')
@Controller('tables')
export class TablesController {
  constructor(private readonly floor: FloorService) {}

  @Get()
  list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.floor.list(includeInactive);
  }

  @Post()
  @RequirePermission('settings', 'manage')
  create(@Body() dto: CreateTableDto) {
    return this.floor.create(dto);
  }

  @Patch(':id')
  @RequirePermission('settings', 'manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.floor.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('order', 'update')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTableStatusDto,
  ) {
    return this.floor.setStatus(id, dto);
  }
}
