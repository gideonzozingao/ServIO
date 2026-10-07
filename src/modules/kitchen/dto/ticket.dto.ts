import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { TicketStatus } from '../../../database/prisma-client.js';

export class TicketBoardQueryDto {
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsUUID() 
  station?: string;

  @ApiPropertyOptional({ enum: TicketStatus, isArray: true, description: 'Comma-separated; default NEW,PREPARING,READY' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray() 
  @IsEnum(TicketStatus, { each: true })
  status?: TicketStatus[];
}

/** Kitchen bump. CANCELLED is not allowed from the KDS (cancellation happens through voids). */
export class AdvanceTicketDto {
  @ApiProperty({ enum: [TicketStatus.NEW, TicketStatus.PREPARING, TicketStatus.READY, TicketStatus.SERVED] })
  @IsIn([TicketStatus.NEW, TicketStatus.PREPARING, TicketStatus.READY, TicketStatus.SERVED])
  status: TicketStatus;
}
