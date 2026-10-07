import { Reflector } from '@nestjs/core';

import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
// import { IdempotencyInterceptor } from '../../infrastructure/idempotency/idempotency.interceptor';
import { IdempotencyInterceptor } from '../../../infrastructure/idempotency/idempotency.interceptor.js';

export const IDEMPOTENT_KEY = 'servio:idempotent';
export interface IdempotentMeta {
  scope?: string;
}

/** Requires an `Idempotency-Key` header; replays the stored response for retries. */
export const Idempotent = (scope?: string) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, { scope } satisfies IdempotentMeta),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({ name: 'Idempotency-Key', required: true }),
  );
