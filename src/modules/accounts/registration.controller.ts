import { Public } from './../../common/decorators/public/public.decorator.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AcceptInvitationDto, RegisterDto } from './dto/accounts.dto.js';
import { RegistrationService } from './registration.service.js';

/** Public endpoints. Tight per-IP throttles (needs Nginx X-Real-IP + `trust proxy` in production). */
@ApiTags('registration')
@Public()
@Controller('registration')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /** Owner sign-up. Always 202 with the same body; check email to verify. */
  @Post()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.registration.register(dto);
  }

  @Get('slugs/:slug')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  slug(@Param('slug') slug: string) {
    return this.registration.slugAvailable(slug.toLowerCase());
  }

  @Get('invitations/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.registration.previewInvitation(id);
  }

  /** For people without an account. Existing accounts accept via POST /account/invitations/:id/accept. */
  @Post('invitations/:id/accept')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.registration.acceptInvitation(id, dto);
  }
}
