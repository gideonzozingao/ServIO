import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto.js';
import { OrderStatus } from '../../../database/prisma-client.js';

const STATUS_FILTERS = ['open', 'closed', ...Object.values(OrderStatus)] as const;

export class OrderListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: STATUS_FILTERS, description: '`open` = any non-terminal status' })
  @IsOptional() 
  @IsIn(STATUS_FILTERS) 
  status?: (typeof STATUS_FILTERS)[number];
  
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsUUID() 
  tableId?: string;
  
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsUUID() 
  waiterId?: string;
  
  @ApiPropertyOptional({ example: '2026-10-07' }) 
  @IsOptional() 
  @Matches(/^\d{4}-\d{2}-\d{2}$/) 
  businessDate?: string;
}
