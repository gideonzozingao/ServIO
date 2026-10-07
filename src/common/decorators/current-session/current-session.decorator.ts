import { RequestSession } from './../../types/tx.type.js';
import { Reflector } from '@nestjs/core';
import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestSession => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.servio) throw new UnauthorizedException();
    return req.servio as RequestSession;
  },
);
