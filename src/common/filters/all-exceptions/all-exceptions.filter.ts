import { DomainException } from './../../exceptions/domain.exceptions.js';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '../../../database/prisma-client.js';
// import { DomainException } from '../exceptions/domain.exceptions.js';

interface ErrorEnvelope {
  message: string;
  code: string;
  errors: Record<string, unknown>;
}

const PRISMA_MAP: Record<
  string,
  { status: number; code: string; message: string }
> = {
  P2002: {
    status: 409,
    code: 'UNIQUE_VIOLATION',
    message: 'Resource already exists',
  },
  P2025: { status: 404, code: 'NOT_FOUND', message: 'Resource not found' },
  P2003: {
    status: 409,
    code: 'FK_VIOLATION',
    message: 'Related resource missing or still referenced',
  },
  P2034: {
    status: 409,
    code: 'WRITE_CONFLICT',
    message: 'Concurrent update, please retry',
  },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse();
    const [status, body] = this.toEnvelope(exception);
    if (status >= 500)
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    this.adapterHost.httpAdapter.reply(res, body, status);
  }

  private toEnvelope(e: unknown): [number, ErrorEnvelope] {
    if (e instanceof DomainException)
      return [e.status, { message: e.message, code: e.code, errors: e.errors }];

    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse() as
        string | { message?: string | string[]; code?: string };
      const code =
        (typeof r === 'object' && r.code) || (HttpStatus[status] ?? 'ERROR');
      if (typeof r === 'string')
        return [status, { message: r, code, errors: {} }];
      if (Array.isArray(r.message))
        return [
          status,
          {
            message: 'Validation failed',
            code: 'VALIDATION_FAILED',
            errors: { fields: r.message },
          },
        ];
      return [status, { message: r.message ?? e.message, code, errors: {} }];
    }

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      const m = PRISMA_MAP[e.code];
      if (m)
        return [
          m.status,
          {
            message: m.message,
            code: m.code,
            errors: { target: e.meta?.target ?? null },
          },
        ];
    }

    return [
      500,
      { message: 'Internal server error', code: 'INTERNAL', errors: {} },
    ];
  }
}
