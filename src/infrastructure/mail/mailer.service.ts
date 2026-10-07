import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { RedisService } from '../redis/redis.service.js';
import type { MailMessage } from './mail.templates.js';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Implement with SES / Postmark / SMTP and bind to MAIL_TRANSPORT in MailModule. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/** Default transport until a provider is chosen: logs the message. */
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mailer');
  async send(m: MailMessage) {
    this.logger.warn(
      `[${m.kind}] to=${m.to} subject="${m.subject}"${m.link ? ` link=${m.link}` : ''}`,
    );
  }
}

const OUTBOX_TTL = 3600;
export const devOutboxKey = (email: string) =>
  `dev:outbox:${email.toLowerCase()}`;

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly isProd: boolean;

  constructor(
    private readonly transport: MailTransport,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.isProd = config.getOrThrow<AppConfig>('app').isProd;
  }

  /** Never throws: a mail outage must not fail registration or password reset. Failures are logged. */
  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.send(message);
    } catch (e) {
      this.logger.error(
        `mail to ${message.to} failed: ${(e as Error).message}`,
      );
    }
    // Dev/test outbox so e2e tests can follow verification/invitation links. Never in production.
    if (!this.isProd) {
      const key = devOutboxKey(message.to);
      await this.redis.client
        .multi()
        .lpush(key, JSON.stringify(message))
        .ltrim(key, 0, 19)
        .expire(key, OUTBOX_TTL)
        .exec();
    }
  }
}
