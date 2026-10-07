import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { CurrentSession } from './../../common/decorators/current-session/current-session.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';

import type { RequestSession } from '../../common/types/tx.type.js';
import type { InvitationRow } from '../auth/account-auth.service.js';
import { CreateInvitationDto } from './dto/accounts.dto.js';
import { InvitationsService } from './invitations.service.js';

const STATUSES = ['pending', 'accepted', 'rejected', 'canceled'] as const;

@ApiTags('invitations')
@Controller('invitations')
@RequirePermission('staff', 'manage')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  invite(
    @CurrentSession() s: RequestSession,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.invite(s, dto);
  }

  @Get()
  @ApiQuery({ name: 'status', enum: STATUSES, required: false })
  list(@CurrentSession() s: RequestSession, @Query('status') status?: string) {
    const st = STATUSES.includes(status as never)
      ? (status as InvitationRow['status'])
      : undefined;
    return this.invitations.list(s, st);
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(
    @CurrentSession() s: RequestSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.resend(s, id);
  }

  @Delete(':id')
  @HttpCode(204)
  cancel(
    @CurrentSession() s: RequestSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.cancel(s, id);
  }
}
