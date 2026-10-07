import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CreateStationDto, UpdateStationDto } from './dto/settings.dto.js';

import { StationsService } from './stations.service.js';

@ApiTags('settings')
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  list(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.stations.list(includeInactive);
  }

  @Post()
  @RequirePermission('settings', 'manage')
  create(@Body() dto: CreateStationDto) {
    return this.stations.create(dto);
  }

  @Patch(':id')
  @RequirePermission('settings', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStationDto,
  ) {
    return this.stations.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings', 'manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stations.remove(id);
  }
}
