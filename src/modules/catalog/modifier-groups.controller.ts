import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/catalog.dto.js';

@ApiTags('catalog')
@Controller()
@RequirePermission('menu', 'manage')
export class ModifierGroupsController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('menu-items/:menuItemId/modifier-groups')
  createGroup(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.catalog.createGroup(menuItemId, dto);
  }

  @Patch('modifier-groups/:id')
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    return this.catalog.updateGroup(id, dto);
  }

  @Delete('modifier-groups/:id')
  @HttpCode(204)
  deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteGroup(id);
  }

  @Post('modifier-groups/:groupId/modifiers')
  createModifier(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateModifierDto,
  ) {
    return this.catalog.createModifier(groupId, dto);
  }

  @Patch('modifiers/:id')
  updateModifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    return this.catalog.updateModifier(id, dto);
  }

  @Delete('modifiers/:id')
  @HttpCode(204)
  deleteModifier(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteModifier(id);
  }
}
