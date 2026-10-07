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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/catalog.dto.js';

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get() list() {
    return this.catalog.listCategories();
  }

  @Post()
  @RequirePermission('menu', 'manage')
  create(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch(':id')
  @RequirePermission('menu', 'manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete(':id')
  @RequirePermission('menu', 'manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteCategory(id);
  }
}
