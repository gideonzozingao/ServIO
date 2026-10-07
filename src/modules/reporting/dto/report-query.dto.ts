import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DailyReportQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-07',
    description: 'Business date; defaults to today',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  date?: string;
}

export class RangeReportQueryDto {
  @ApiProperty({ example: '2026-10-01' })
  @Matches(ISO_DATE)
  from: string;

  @ApiProperty({ example: '2026-10-07' })
  @Matches(ISO_DATE)
  to: string;
  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
