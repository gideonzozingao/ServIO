import { CurrentSession } from './../../common/decorators/current-session/current-session.decorator.js';
import { Idempotent } from './../../common/decorators/idempotent/idempotent.decorator.js';
import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RequestSession } from '../../common/types/tx.type.js';
import { AddItemsDto, CreateOrderDto } from './dto/create-order.dto.js';
import { OrderListQueryDto } from './dto/order-query.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';

import { OrderQueryService } from './order-query.service.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly query: OrderQueryService) {}

  @Post()
  @RequirePermission('order', 'create')
  @Idempotent('POST /orders')
  create(@CurrentSession() s: RequestSession, @Body() dto: CreateOrderDto) {
    return this.orders.create(s, dto);
  }

  @Get()
  @RequirePermission('order', 'update')
  list(@CurrentSession() s: RequestSession, @Query() q: OrderListQueryDto) {
    return this.query.list(s, q);
  }

  @Get(':id')
  @RequirePermission('order', 'update')
  get(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.get(s, id);
  }

  @Post(':id/items')
  @RequirePermission('order', 'update')
  addItems(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemsDto) {
    return this.orders.addItems(s, id, dto.items);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('order', 'update')
  updateItem(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateItemDto) {
    return this.orders.updateItem(s, id, itemId, dto);
  }

  /** Before send only. After send → POST /orders/:id/items/:itemId/void (approval). */
  @Delete(':id/items/:itemId')
  @RequirePermission('order', 'update')
  removeItem(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.orders.removeItem(s, id, itemId);
  }

  @Post(':id/cancel')
  @RequirePermission('order', 'update')
  cancel(@CurrentSession() s: RequestSession, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.orders.cancel(s, id, typeof reason === 'string' ? reason.slice(0, 300) : undefined);
  }
}
