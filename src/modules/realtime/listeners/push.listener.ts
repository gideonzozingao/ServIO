import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import type { DomainEventMap } from '../../../infrastructure/events/domain-events.catalog.js';
import { JOBS, QUEUES, type PushTicketReadyJob } from '../../../jobs/queues.js';

/** ticket.ready → push job for the waiter's device (processed by the worker). */
@Injectable()
export class PushListener {
  private readonly logger = new Logger(PushListener.name);
  constructor(@InjectQueue(QUEUES.notifications) private readonly queue: Queue) {}

  @OnEvent('ticket.ready', { async: true })
  async ready(e: DomainEventMap['ticket.ready']) {
    const data: PushTicketReadyJob = { restaurantId: e.restaurantId, waiterId: e.waiterId, orderId: e.orderId, orderNumber: e.orderNumber, tableLabel: e.tableLabel };
    try {
      await this.queue.add(JOBS.pushTicketReady, data, { jobId: `ready-${e.ticketId}`, removeOnComplete: 1000, removeOnFail: 1000, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    } catch (err) {
      this.logger.warn(`could not enqueue push: ${(err as Error).message}`);
    }
  }
}
