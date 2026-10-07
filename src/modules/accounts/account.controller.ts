import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';

import { AccountService } from './account.service.js';
import {
  ChangeEmailDto,
  ChangePasswordDto,
  SetActiveRestaurantDto,
  UpdateAccountDto,
} from './dto/accounts.dto.js';
import {
  CurrentUser,
  SessionOnly,
  type SessionUser,
} from '../../common/decorators/session-only/session-only.decorator.js';
/** The signed-in person's own account. Works without an active restaurant. */
@ApiTags('account')
@SessionOnly()
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  get(@CurrentUser() u: SessionUser) {
    return this.account.get(u);
  }

  @Patch()
  update(
    @CurrentUser() u: SessionUser,
    @Body() dto: UpdateAccountDto,
    @Req() req: Request,
  ) {
    return this.account.update(u, dto, fromNodeHeaders(req.headers));
  }

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  changePassword(
    @CurrentUser() u: SessionUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.account.changePassword(
      u,
      dto,
      fromNodeHeaders(req.headers),
      res,
    );
  }

  @Post('email')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  changeEmail(
    @CurrentUser() u: SessionUser,
    @Body() dto: ChangeEmailDto,
    @Req() req: Request,
  ) {
    return this.account.changeEmail(u, dto, fromNodeHeaders(req.headers));
  }

  @Get('sessions')
  sessions(@CurrentUser() u: SessionUser) {
    return this.account.sessions(u);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.account.revokeSession(u, id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@CurrentUser() u: SessionUser) {
    return this.account.revokeOthers(u);
  }

  /** Multi-restaurant: switch which restaurant this session acts on. */
  @Post('active-restaurant')
  @HttpCode(200)
  setActive(
    @CurrentUser() u: SessionUser,
    @Body() dto: SetActiveRestaurantDto,
  ) {
    return this.account.setActiveRestaurant(u, dto.restaurantId);
  }

  @Get('invitations')
  invitations(@CurrentUser() u: SessionUser) {
    return this.account.myInvitations(u);
  }

  @Post('invitations/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.account.acceptInvitation(u, id);
  }

  @Post('invitations/:id/reject')
  @HttpCode(204)
  reject(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.account.rejectInvitation(u, id);
  }
}
