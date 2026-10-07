import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../database/prisma-client.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';

const IN_FLIGHT = 0;
const TTL_HOURS = 24;

export type BeginResult =
  | { kind: 'proceed'; id: string }
  | { kind: 'replay'; status: number; body: unknown };

/**
 * Reserve-then-complete:
 *  1. INSERT a reservation row (status 0). The unique (restaurant_id, key, scope) makes this the race guard.
 *  2. On conflict: same hash + completed → replay; same hash + in flight → 409; different hash → 409.
 *  3. After the handler succeeds, store the response; on failure, delete the reservation so the client can retry.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: TenantPrismaService) {}

  async begin(
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<BeginResult> {
    try {
      const row = await this.db.run((tx) =>
        tx.idempotencyKey.create({
          data: {
            restaurantId: rid(),
            key,
            scope,
            requestHash,
            responseStatus: IN_FLIGHT,
            responseBody: {},
            expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
          },
          select: { id: true },
        }),
      );
      return { kind: 'proceed', id: row.id };
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== 'P2002'
      )
        throw e;
    }

    const existing = await this.db.run((tx) =>
      tx.idempotencyKey.findFirst({ where: { key, scope } }),
    );
    if (!existing)
      throw new ConflictException('Idempotency key conflict, retry');
    if (existing.requestHash !== requestHash)
      throw new ConflictException(
        'Idempotency-Key reused with a different request',
      );
    if (existing.responseStatus === IN_FLIGHT)
      throw new ConflictException(
        'Request with this Idempotency-Key is still in progress',
      );
    return {
      kind: 'replay',
      status: existing.responseStatus,
      body: existing.responseBody,
    };
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    const json =
      body === undefined
        ? null
        : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue);
    await this.db.run((tx) =>
      tx.idempotencyKey.update({
        where: { id },
        data: { responseStatus: status, responseBody: json ?? Prisma.JsonNull },
      }),
    );
  }

  async abort(id: string): Promise<void> {
    await this.db.run((tx) => tx.idempotencyKey.deleteMany({ where: { id } }));
  }
}
