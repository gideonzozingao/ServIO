import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  DomainEventMap,
  DomainEventName,
} from './domain-events.catalog.js';

/**
 * Typed, in-process domain events. RULE: emit only after the transaction has committed
 * (i.e. after withTenant() resolves). Listener failures are logged, never propagated to the caller.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  constructor(private readonly emitter: EventEmitter2) {}

  emit<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): void {
    try {
      this.emitter.emit(name, payload);
    } catch (err) {
      this.logger.error(
        `listener for ${name} failed: ${(err as Error).message}`,
      );
    }
  }

  emitAll(
    events: ReadonlyArray<
      {
        [K in DomainEventName]: { name: K; payload: DomainEventMap[K] };
      }[DomainEventName]
    >,
  ): void {
    for (const e of events) this.emit(e.name, e.payload as never);
  }
}

/** Helper to collect events inside a use case and emit them after commit. */
export type PendingEvent = {
  [K in DomainEventName]: { name: K; payload: DomainEventMap[K] };
}[DomainEventName];
export const evt = <K extends DomainEventName>(
  name: K,
  payload: DomainEventMap[K],
) => ({ name, payload }) as PendingEvent;
