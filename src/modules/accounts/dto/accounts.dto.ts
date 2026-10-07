import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUrl, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { INVITABLE_ROLES, type InvitableRole } from '../../auth/account-auth.service.js';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
const PASSWORD = { min: 10, max: 128 };

export class RegisterDto {
  @ApiProperty({ example: 'Daikoku Waigani' })
   @trim() 
   @IsString() 
   @Length(2, 80) 
   restaurantName: string;
  
   @ApiPropertyOptional({ example: 'daikoku-waigani', description: 'URL handle; generated from the name if omitted' })
  @IsOptional()
   @lower() 
   @Matches(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
     { message: 'slug: 3–40 chars, lowercase letters, digits and dashes' })
  slug?: string;
  
  @ApiProperty({ example: 'Jane Owner' }) 
  @trim() 
  @IsString() 
  @Length(2, 80) 
  ownerName: string;
  
  @ApiProperty() 
  @lower() 
  @IsEmail() 
  @MaxLength(254) 
  email: string;

  @ApiProperty({ minLength: PASSWORD.min }) 
  @IsString() 
  @MinLength(PASSWORD.min) 
  @MaxLength(PASSWORD.max) 
  password: string;
}

export class AcceptInvitationDto {
  @ApiProperty() 
  @trim() 
  @IsString() 
  @Length(2, 80) 
  name: string;

  @ApiProperty({ minLength: PASSWORD.min }) 
  @IsString() 
  @MinLength(PASSWORD.min) 
  @MaxLength(PASSWORD.max) password: string;
}

export class CreateInvitationDto {
  @ApiProperty() 
  @lower() 
  @IsEmail() 
  @MaxLength(254) 
  email: string;

  @ApiProperty({ enum: INVITABLE_ROLES,
     description: 'Email-login roles only; floor staff are created with a PIN' })
  @IsIn(INVITABLE_ROLES) 
  role: InvitableRole;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional() 
  @trim() 
  @IsString() 
  @Length(2, 80) 
  name?: string;
  @ApiPropertyOptional() 
  @IsOptional() 
  @IsUrl({ protocols: ['https'], require_protocol: true }) 
  @MaxLength(500) image?: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() 
  @MaxLength(PASSWORD.max) 
  currentPassword: string;
  @ApiProperty({ minLength: PASSWORD.min }) 
  @IsString() 
  @MinLength(PASSWORD.min) 
  @MaxLength(PASSWORD.max) 
  newPassword: string;
  @ApiPropertyOptional({ default: true }) 
  @IsOptional() 
  @IsBoolean() 
  revokeOtherSessions?: boolean;
}

export class ChangeEmailDto {
  @ApiProperty() 
  @lower() 
  @IsEmail() 
  @MaxLength(254) 
  newEmail: string;
}

export class SetActiveRestaurantDto {
  @ApiProperty() 
  @IsString() 
  @Length(36, 36) restaurantId: string;
}
