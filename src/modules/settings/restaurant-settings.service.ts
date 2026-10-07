import { RestaurantSettings } from './types/settings.types.js';

import { DomainEvents } from './../../infrastructure/events/domain-events.service.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/exceptions/domain.exceptions.js';
import type { TaxRule } from '../../common/money/tax.util.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import {
  businessDateFor,
  isValidTimezone,
  type BusinessDate,
} from '../../common/utils/business-date.util.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { tenantScope } from '../../database/tenant-scope.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
// import { DomainEvents } from '../../infrastructure/events/domain-events.service.js`';

import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { UpdateRestaurantSettingsDto } from './dto/settings.dto.js';

const TTL = 300;
const key = (id: string) => `settings:${id}`;

@Injectable()
export class RestaurantSettingsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Cached settings. Pass `tx` when already inside a tenant transaction (avoids a second connection on cache miss).
   * Outside HTTP (jobs), call inside withTenant and pass tx.
   */
  async get(tx?: TenantTx): Promise<RestaurantSettings> {
    const restaurantId = this.db.restaurantId;
    const cached = await this.redis.getJson<RestaurantSettings>(
      key(restaurantId),
    );
    if (cached) return cached;

    const load = (t: TenantTx) =>
      t.restaurant.findUnique({ where: { id: restaurantId } });
    const row = tx ? await load(tx) : await this.db.runFor(restaurantId, load);
    if (!row) throw new NotFoundException('Restaurant not provisioned');

    const extra = (row.settings ?? {}) as { dayRolloverHour?: number };
    const settings: RestaurantSettings = {
      restaurantId,
      currency: row.currency,
      taxRateBps: row.taxRateBps,
      pricesIncludeTax: row.pricesIncludeTax,
      timezone: row.timezone,
      dayRolloverHour: extra.dayRolloverHour ?? 4,
    };
    await this.redis.setJson(key(restaurantId), settings, TTL);
    return settings;
  }

  async businessDate(tx?: TenantTx, now = new Date()): Promise<BusinessDate> {
    const s = await this.get(tx);
    return businessDateFor(now, s.timezone, s.dayRolloverHour);
  }

  async update(dto: UpdateRestaurantSettingsDto) {
    if (dto.timezone && !isValidTimezone(dto.timezone))
      throw new DomainException('Unknown timezone', 'INVALID_TIMEZONE');
    const restaurantId = await this.db.run(async (tx) => {
      const id = tenantScope.require();
      const before = await tx.restaurant.findUniqueOrThrow({ where: { id } });
      const settingsJson = {
        ...((before.settings ?? {}) as object),
        ...(dto.dayRolloverHour !== undefined
          ? { dayRolloverHour: dto.dayRolloverHour }
          : {}),
      };
      const after = await tx.restaurant.update({
        where: { id },
        data: {
          currency: dto.currency,
          taxRateBps: dto.taxRateBps,
          pricesIncludeTax: dto.pricesIncludeTax,
          timezone: dto.timezone,
          settings: settingsJson,
        },
      });
      await this.audit.record(tx, {
        action: 'settings.update',
        subjectType: 'restaurant',
        subjectId: id,
        before: {
          currency: before.currency,
          taxRateBps: before.taxRateBps,
          pricesIncludeTax: before.pricesIncludeTax,
          timezone: before.timezone,
          settings: before.settings as object,
        },
        after: {
          currency: after.currency,
          taxRateBps: after.taxRateBps,
          pricesIncludeTax: after.pricesIncludeTax,
          timezone: after.timezone,
          settings: after.settings as object,
        },
      });
      return id;
    });
    await this.redis.del(key(restaurantId));
    this.events.emit('settings.updated', { restaurantId });
    return this.get();
  }
}
