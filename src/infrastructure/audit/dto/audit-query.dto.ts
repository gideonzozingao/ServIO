import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto.js';

export class AuditQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) subjectType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
  @ApiPropertyOptional({ description: 'ISO timestamp (inclusive)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'ISO timestamp (exclusive)' }) @IsOptional() @IsISO8601() to?: string;
}
