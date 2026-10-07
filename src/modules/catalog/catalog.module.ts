import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CategoriesController } from './categories.controller.js';
import { MenuItemsController } from './menu-items.controller.js';
import { MenuQueryService } from './menu-query.service.js';
import { MenuController } from './menu.controller.js';
import { ModifierGroupsController } from './modifier-groups.controller.js';

@Module({
  controllers: [MenuController, CategoriesController, MenuItemsController, ModifierGroupsController],
  providers: [CatalogService, MenuQueryService],
  exports: [MenuQueryService],
})
export class CatalogModule {}
