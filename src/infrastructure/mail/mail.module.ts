import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service.js';
import { LogMailTransport, MAIL_TRANSPORT, MailerService, type MailTransport } from './mailer.service.js';
@Global()
@Module({
  providers: [
    { provide: MAIL_TRANSPORT, useClass: LogMailTransport },
    {
      provide: MailerService,
      inject: [MAIL_TRANSPORT, RedisService, ConfigService],
      useFactory: (t: MailTransport, r: RedisService, c: ConfigService) => new MailerService(t, r, c),
    },
  ],
  exports: [MailerService],
})
export class MailModule {}
