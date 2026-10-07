import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VoidDto {
  @ApiProperty() @IsString() @Length(3, 300) reason: string;
}
