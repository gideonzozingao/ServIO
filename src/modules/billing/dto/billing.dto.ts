import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaymentMethod } from '../../../database/prisma-client.js';

export class RecordPaymentDto {
  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiProperty({ description: 'Amount applied to the bill (minor units)' })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountMinor: number;

  @ApiPropertyOptional({
    description: 'Cash handed over; change = tendered - amount',
  })
  @ValidateIf((o: RecordPaymentDto) => o.tenderedMinor !== undefined)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  tenderedMinor?: number;

  @ApiPropertyOptional({
    description: 'Card slip / mobile money transaction id',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

/** Exactly one of amountMinor / percentBps. */
export class ApplyDiscountDto {
  @ApiPropertyOptional()
  @ValidateIf((o: ApplyDiscountDto) => o.percentBps === undefined)
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @ApiPropertyOptional({ description: '1000 = 10%' })
  @ValidateIf((o: ApplyDiscountDto) => o.amountMinor === undefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  percentBps?: number;

  @ApiProperty()
  @IsString()
  @Length(3, 300)
  reason: string;
}
