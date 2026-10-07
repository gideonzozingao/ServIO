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
import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';

import { CatalogService } from './catalog.service.js';
import {
  CreateMenuItemDto,
  SetAvailabilityDto,
  UpdateMenuItemDto,
} from './dto/catalog.dto.js';

@ApiTags('catalog')
@Controller('menu-items')
export class MenuItemsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(
    @Query('categoryId', new ParseUUIDPipe({ optional: true }))
    categoryId?: string,
    @Query('includeArchived', new ParseBoolPipe({ optional: true }))
    includeArchived?: boolean,
  ) {
    return this.catalog.listItems(categoryId, includeArchived);
  }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getItem(id);
  }

  @Post()
  @RequirePermission('menu', 'manage')
  create(@Body() dto: CreateMenuItemDto) {
    return this.catalog.createItem(dto);
  }

  @Patch(':id')
  @RequirePermission('menu', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.catalog.updateItem(id, dto);
  }

  /** Kitchen leads 86 items through a manager account; widen to ticket:update if kitchen should toggle directly. */
  @Patch(':id/availability')
  @RequirePermission('menu', 'manage')
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.catalog.setAvailability(id, dto.available);
  }

  @Delete(':id')
  @RequirePermission('menu', 'manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteItem(id);
  }
}
