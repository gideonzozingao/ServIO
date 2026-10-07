import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { TableStatus } from '../../../database/prisma-client.js';

export class CreateTableDto {
  @ApiProperty({ example: 'T4' }) 
  @IsString() 
  @Length(1, 20) 
  label: string;
  
  @ApiPropertyOptional({ example: 'Patio' })
  @IsOptional() 
  @IsString() 
  @Length(1, 40) 
  section?: string;

  @ApiPropertyOptional({ default: 2 }) 
  @IsOptional() 
  @IsInt() 
  @Min(1) 
  @Max(50) 
  seats?: number;
}
export class UpdateTableDto extends PartialType(CreateTableDto) {
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsBoolean() 
  active?: boolean;
}
export class SetTableStatusDto {
  @ApiProperty({ enum: TableStatus }) 
  @IsEnum(TableStatus) 
  status: TableStatus;
}
