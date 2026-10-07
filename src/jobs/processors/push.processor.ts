import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, type PushTicketReadyJob } from '../queues.js';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushSender {
  sendToUser(restaurantId: string, userId: string, message: { title: string; body: string; data?: Record<string, string> }): Promise<void>;
}

/** Placeholder until a provider is chosen (Expo push / FCM). Sockets already deliver ticket.ready in-app. */
@Injectable()
export class LogPushSender implements PushSender {
  private readonly logger = new Logger('Push');
  async sendToUser(restaurantId: string, userId: string, message: { title: string; body: string }) {
    this.logger.log(`[${restaurantId}] → ${userId}: ${message.title} — ${message.body}`);
  }
}

@Processor(QUEUES.notifications)
export class PushProcessor extends WorkerHost {
  constructor(@Inject(PUSH_SENDER) private readonly sender: PushSender) {
    super();
  }

  async process(job: Job<PushTicketReadyJob>) {
    const d = job.data;
    await this.sender.sendToUser(d.restaurantId, d.waiterId, {
      title: `Order #${d.orderNumber} ready`,
      body: d.tableLabel ? `Table ${d.tableLabel}` : 'Takeaway',
      data: { orderId: d.orderId },
    });
  }
}
