import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly health: HealthIndicatorService,
  ) {}

  async check(key = 'redis') {
    const i = this.health.check(key);
    try {
      return (await this.redis.ping())
        ? i.up()
        : i.down({ message: 'no PONG' });
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
