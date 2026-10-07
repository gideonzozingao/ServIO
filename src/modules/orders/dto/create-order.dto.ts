import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { OrderType } from '../../../database/prisma-client.js';

export class AddItemDto {
  @ApiProperty() 
  @IsUUID() 
  menuItemId: string;
  
  @ApiProperty({ minimum: 1, maximum: 99 }) 
  @IsInt() 
  @Min(1) 
  @Max(99) 
  qty: number;
  
  @ApiPropertyOptional({ type: [String] }) 
  @IsOptional() 
  @IsArray() 
  @ArrayMaxSize(30) 
  @IsUUID('all', { each: true }) 
  modifierIds?: string[];
  
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsString() 
  @MaxLength(200) notes?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Client-generated UUID (offline creation). Server generates one if omitted.' })
  @IsOptional() 
  @IsUUID() id?: string;

  @ApiProperty({ enum: OrderType }) 
  @IsEnum(OrderType) 
  type: OrderType;

  @ApiPropertyOptional({ description: 'Required for DINE_IN' })
  @ValidateIf((o: CreateOrderDto) => o.type === OrderType.DINE_IN) @IsUUID() tableId?: string;

  @ApiPropertyOptional() 
  @IsOptional() 
  @IsInt() 
  @Min(1) 
  @Max(100) 
  covers?: number;

  @ApiPropertyOptional() 
  @IsOptional() 
  @IsString() 
  @MaxLength(500) 
  customerNote?: string;

  @ApiPropertyOptional({ type: [AddItemDto] })
  @IsOptional() 
  @IsArray() 
  @ArrayMaxSize(100) 
  @ValidateNested({ each: true }) 
  @Type(() => AddItemDto)
  items?: AddItemDto[];
}

export class AddItemsDto {
  @ApiProperty({ type: [AddItemDto] })
  @IsArray() 
  @ArrayMinSize(1)
   @ArrayMaxSize(100) 
   @ValidateNested({ each: true }) 
   @Type(() => AddItemDto)
  items: AddItemDto[];
}
