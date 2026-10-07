import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../infrastructure/events/domain-events.catalog.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { reportCachePrefix } from './report-query.service.js';

/** Money moved → drop this restaurant's cached reports. */
@Injectable()
export class ReportCacheListener {
  constructor(private readonly redis: RedisService) {}

  @OnEvent('payment.recorded', { async: true })
  @OnEvent('order.closed', { async: true })
  async invalidate(
    e: DomainEventMap['payment.recorded'] | DomainEventMap['order.closed'],
  ) {
    await this.redis.delByPrefix(reportCachePrefix(e.restaurantId));
  }
}
