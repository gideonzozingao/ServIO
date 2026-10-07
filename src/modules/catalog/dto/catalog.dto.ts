import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, Max } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty() @IsString() @Length(1, 60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateMenuItemDto {
  @ApiProperty() 
  @IsUUID() 
  categoryId: string;
  
  @ApiProperty({ description: 'Kitchen station this item routes to' }) 
  @IsUUID() 
  stationId: string;
  
  @ApiProperty() @
  IsString() 
  @Length(1, 80) 
  name: string;

  @ApiPropertyOptional() 
  @IsOptional() 
  @IsString() 
  @MaxLength(500) 
  description?: string;
  
  @ApiProperty({ description: 'minor units (toea)' }) 
  @IsInt() 
  @Min(0) 
  @Max(100_000_000) 
  priceMinor: number;

  @ApiPropertyOptional() 
  @IsOptional() 
  @IsString() 
  @MaxLength(300) 
  imagePath?: string;
  
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsInt() 
  @Min(0) 
  sortOrder?: number;
  
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsBoolean() 
  available?: boolean;
}
export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

export class SetAvailabilityDto {
  @ApiProperty() 
  @IsBoolean() 
  available: boolean;
}

export class CreateModifierGroupDto {
  @ApiProperty({ example: 'Doneness' }) 
  @IsString() 
  @Length(1, 60) 
  name: string;
  @ApiPropertyOptional({ default: 0 }) 
  @IsOptional() 
  @IsInt() 
  @Min(0) 
  @Max(20) 
  minSelect?: number;
  
  @ApiPropertyOptional({ default: 1 }) 
  @IsOptional() 
  @IsInt() 
  @Min(1) 
  @Max(20) maxSelect?: number;
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsInt() 
  @Min(0) sortOrder?: number;
}
export class UpdateModifierGroupDto extends PartialType(CreateModifierGroupDto) {}

export class CreateModifierDto {
  @ApiProperty({ example: 'Extra cheese' }) 
  @IsString() 
  @Length(1, 60) 
  name: string;

  @ApiPropertyOptional({ description: 'minor units, may be 0' }) 
  @IsOptional() 
  @IsInt() 
  @Min(-10_000_000) 
  @Max(10_000_000) priceDeltaMinor?: number;
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsBoolean() available?: boolean;
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsInt() 
  @Min(0) sortOrder?: number;
}
export class UpdateModifierDto extends PartialType(CreateModifierDto) {}
