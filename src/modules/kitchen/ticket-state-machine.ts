import { Injectable } from '@nestjs/common';
import { InvalidStateException } from '../../common/exceptions/domain.exceptions.js';
import { ItemStatus, TicketStatus } from '../../database/prisma-client.js';

const T = TicketStatus;

/** READY → PREPARING allows the kitchen to "recall" a bumped ticket. */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: [T.PREPARING, T.READY, T.CANCELLED],
  PREPARING: [T.READY, T.NEW, T.CANCELLED],
  READY: [T.SERVED, T.PREPARING],
  SERVED: [],
  CANCELLED: [],
};

/** Item status mirrors its ticket (voided items are never touched). */
export const ITEM_STATUS_FOR_TICKET: Record<TicketStatus, ItemStatus | null> = {
  NEW: ItemStatus.PENDING,
  PREPARING: ItemStatus.PREPARING,
  READY: ItemStatus.READY,
  SERVED: ItemStatus.SERVED,
  CANCELLED: null,
};

@Injectable()
export class TicketStateMachine {
  assertCan(from: TicketStatus, to: TicketStatus) {
    if (!TRANSITIONS[from].includes(to)) throw new InvalidStateException(`Invalid ticket transition ${from} -> ${to}`);
  }
}
