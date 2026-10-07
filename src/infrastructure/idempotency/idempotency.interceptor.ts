import {
  IDEMPOTENT_KEY,
  type IdempotentMeta,
} from './../../common/decorators/idempotent/idempotent.decorator.js';
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  catchError,
  from,
  mergeMap,
  map,
  Observable,
  of,
  throwError,
} from 'rxjs';
// import { IDEMPOTENT_KEY, type IdempotentMeta } from '../../common/decorators/idempotent.decorator.js';
import { IdempotencyService } from './idempotency.service.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly service: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<IdempotentMeta>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || key.length > 200)
      throw new BadRequestException(
        'Idempotency-Key header is required (max 200 chars)',
      );

    const scope = meta.scope ?? `${req.method} ${req.route?.path ?? req.path}`;
    const hash = createHash('sha256')
      .update(JSON.stringify({ params: req.params, body: req.body ?? null }))
      .digest('hex');

    return from(this.service.begin(key, scope, hash)).pipe(
      mergeMap((state) => {
        if (state.kind === 'replay') {
          res.status(state.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(state.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.service.complete(state.id, res.statusCode, body)).pipe(
              map(() => body),
            ),
          ),
          catchError((err) =>
            from(this.service.abort(state.id)).pipe(
              mergeMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }
}
