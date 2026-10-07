import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STAFF_ROLES, type StaffRole } from '../../../common/types/tx.type.js';

export class CreateStaffDto {
  @ApiProperty() @IsString() @Length(1, 80) name: string;
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) role: StaffRole;
  @ApiPropertyOptional({ description: 'Required for owner/manager' })
  @IsOptional()
  @IsEmail()
  email?: string;
  @ApiPropertyOptional({ description: 'Required for owner/manager' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password?: string;
  @ApiPropertyOptional({ description: '4–6 digits' })
  @IsOptional()
  @Matches(/^\d{4,6}$/)
  pin?: string;
}

export class UpdateStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;
}

export class SetPinDto {
  @ApiProperty({ description: '4–6 digits' }) @Matches(/^\d{4,6}$/) pin: string;
}

export class RegisterDeviceDto {
  @ApiProperty({ example: 'Bar iPad' }) @IsString() @Length(1, 60) name: string;
}
