import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ description: 'id of the last item from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

/** Prisma cursor args: fetch limit+1 to know whether there is a next page. Pair with a stable orderBy incl. id. */
export function cursorArgs(p: PaginationDto) {
  return { take: p.limit + 1, ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}) };
}
