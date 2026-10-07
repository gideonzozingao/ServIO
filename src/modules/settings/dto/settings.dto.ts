import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class UpdateRestaurantSettingsDto {
  @ApiPropertyOptional({ example: 'PGK' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional({ description: 'basis points, 1000 = 10%' }) @IsOptional() @IsInt() @Min(0) @Max(5000) taxRateBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @ApiPropertyOptional({ example: 'Pacific/Port_Moresby' }) @IsOptional() @IsString() timezone?: string;
  @ApiPropertyOptional({ description: 'Local hour (0–11) when the business day rolls over' }) @IsOptional() @IsInt() @Min(0) @Max(11) dayRolloverHour?: number;
}

export class CreateStationDto {
  @ApiProperty() @IsString() @Length(1, 40) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateStationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
