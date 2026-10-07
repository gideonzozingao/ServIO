import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';

export interface LineRequest {
  menuItemId: string;
  qty: number;
  modifierIds?: string[];
}

export interface PricedLine {
  menuItemId: string;
  stationId: string;
  name: string;
  unitPriceMinor: number; // base price snapshot
  qty: number;
  modifiers: { modifierId: string; name: string; priceDeltaMinor: number }[];
  lineTotalMinor: number; // (unit + Σ modifier deltas) × qty
}

/**
 * Server-side pricing + validation for order lines. The client sends ids only; names and prices
 * are snapshotted here. Validates availability and modifier group min/max.
 */
@Injectable()
export class MenuQueryService {
  async getPricedItems(
    tx: TenantTx,
    lines: LineRequest[],
  ): Promise<PricedLine[]> {
    if (!lines.length) return [];
    const ids = [...new Set(lines.map((l) => l.menuItemId))];
    const items = await tx.menuItem.findMany({
      where: { id: { in: ids } },
      include: { modifierGroups: { include: { modifiers: true } } },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    return lines.map((line, idx) => {
      const item = byId.get(line.menuItemId);
      const field = `items[${idx}]`;
      if (!item || item.archivedAt)
        throw new DomainException(
          'Menu item not found',
          'ITEM_NOT_FOUND',
          422,
          { field },
        );
      if (!item.available)
        throw new DomainException(
          `${item.name} is unavailable`,
          'ITEM_UNAVAILABLE',
          422,
          { field, menuItemId: item.id },
        );

      const requested = line.modifierIds ?? [];
      if (new Set(requested).size !== requested.length)
        throw new DomainException(
          'Duplicate modifiers',
          'MODIFIER_DUPLICATE',
          422,
          { field },
        );

      const modifierIndex = new Map(
        item.modifierGroups.flatMap((g) =>
          g.modifiers.map((m) => [m.id, { m, g }] as const),
        ),
      );
      const chosen = requested.map((id) => {
        const hit = modifierIndex.get(id);
        if (!hit)
          throw new DomainException(
            'Modifier does not belong to this item',
            'MODIFIER_INVALID',
            422,
            { field, modifierId: id },
          );
        if (!hit.m.available)
          throw new DomainException(
            `${hit.m.name} is unavailable`,
            'MODIFIER_UNAVAILABLE',
            422,
            { field, modifierId: id },
          );
        return hit;
      });

      for (const group of item.modifierGroups) {
        const count = chosen.filter((c) => c.g.id === group.id).length;
        if (count < group.minSelect || count > group.maxSelect) {
          throw new DomainException(
            `${item.name}: choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}–${group.maxSelect}`} for "${group.name}"`,
            'MODIFIER_SELECTION',
            422,
            { field, groupId: group.id },
          );
        }
      }

      const modifiers = chosen.map(({ m }) => ({
        modifierId: m.id,
        name: m.name,
        priceDeltaMinor: m.priceDeltaMinor,
      }));
      const unitWithMods =
        item.priceMinor + modifiers.reduce((s, m) => s + m.priceDeltaMinor, 0);
      if (unitWithMods < 0)
        throw new DomainException(
          'Line price cannot be negative',
          'NEGATIVE_PRICE',
          422,
          { field },
        );

      return {
        menuItemId: item.id,
        stationId: item.stationId,
        name: item.name,
        unitPriceMinor: item.priceMinor,
        qty: line.qty,
        modifiers,
        lineTotalMinor: unitWithMods * line.qty,
      };
    });
  }
}
