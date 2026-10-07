import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainException, EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import type { TenantTx } from '../../common/types/tx.type.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import { DomainEvents } from '../../infrastructure/events/domain-events.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type {
  CreateCategoryDto, CreateMenuItemDto, CreateModifierDto, CreateModifierGroupDto,
  UpdateCategoryDto, UpdateMenuItemDto, UpdateModifierDto, UpdateModifierGroupDto,
} from './dto/catalog.dto.js';

const MENU_TTL = 3600;
const menuKey = (id: string) => `menu:${id}`;

export interface CachedMenu {
  etag: string;
  body: unknown;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // ── Menu tree (waiter/KDS/admin read) ────────────────────────────────────

  async getMenu(): Promise<CachedMenu> {
    const id = this.db.restaurantId;
    const cached = await this.redis.getJson<CachedMenu>(menuKey(id));
    if (cached) return cached;

    const body = await this.db.run(async (tx) => {
      const categories = await tx.category.findMany({
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            items: {
              where: { archivedAt: null },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: {
                modifierGroups: {
                  orderBy: { sortOrder: 'asc' },
                  include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
                },
              },
            },
          },
        });
      const stations = await tx.station.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } });
      return {
        stations,
        categories: categories.map((c) => ({
          id: c.id, name: c.name, sortOrder: c.sortOrder,
          items: c.items.map((i) => ({
            id: i.id, name: i.name, description: i.description, priceMinor: i.priceMinor, available: i.available,
            imagePath: i.imagePath, stationId: i.stationId, sortOrder: i.sortOrder,
            modifierGroups: i.modifierGroups.map((g) => ({
              id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
              modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor, available: m.available })),
            })),
          })),
        })),
      };
    });
    const menu: CachedMenu = { etag: `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`, body };
    await this.redis.setJson(menuKey(id), menu, MENU_TTL);
    return menu;
  }

  /** Call after every committed catalog write. */
  private async invalidate(restaurantId: string) {
    await this.redis.del(menuKey(restaurantId));
    this.events.emit('menu.updated', { restaurantId });
  }

  private async write<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const restaurantId = this.db.restaurantId;
    const result = await this.db.run(fn);
    await this.invalidate(restaurantId);
    return result;
  }

  // ── Categories ───────────────────────────────────────────────────────────

  listCategories() {
    return this.db.run((tx) => tx.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { items: true } } } }));
  }

  createCategory(dto: CreateCategoryDto) {
    return this.write((tx) => tx.category.create({ data: { restaurantId: rid(), name: dto.name, sortOrder: dto.sortOrder ?? 0 } }));
  }

  updateCategory(id: string, dto: UpdateCategoryDto) {
    return this.write(async (tx) => {
      if (!(await tx.category.updateMany({ where: { id }, data: dto })).count) throw new EntityNotFoundException('Category', id);
      return tx.category.findUniqueOrThrow({ where: { id } });
    });
  }

  deleteCategory(id: string) {
    return this.write(async (tx) => {
      const used = await tx.menuItem.count({ where: { categoryId: id } });
      if (used) throw new DomainException('Category still has menu items; deactivate it instead', 'CATEGORY_IN_USE', 409);
      if (!(await tx.category.deleteMany({ where: { id } })).count) throw new EntityNotFoundException('Category', id);
    });
  }

  // ── Menu items ───────────────────────────────────────────────────────────

  listItems(categoryId?: string, includeArchived = false) {
    return this.db.run((tx) =>
      tx.menuItem.findMany({
        where: { categoryId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        include: { modifierGroups: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } } },
      }),
    );
  }

  async getItem(id: string) {
    const item = await this.db.run((tx) =>
      tx.menuItem.findFirst({ where: { id }, include: { modifierGroups: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } } } }),
    );
    if (!item) throw new EntityNotFoundException('Menu item', id);
    return item;
  }

  private async assertRefs(tx: TenantTx, categoryId?: string, stationId?: string) {
    if (categoryId && !(await tx.category.count({ where: { id: categoryId } }))) throw new DomainException('Unknown category', 'CATEGORY_NOT_FOUND');
    if (stationId && !(await tx.station.count({ where: { id: stationId, active: true } }))) throw new DomainException('Unknown or inactive station', 'STATION_NOT_FOUND');
  }

  createItem(dto: CreateMenuItemDto) {
    return this.write(async (tx) => {
      await this.assertRefs(tx, dto.categoryId, dto.stationId);
      return tx.menuItem.create({ data: { ...dto, restaurantId: rid() } });
    });
  }

  updateItem(id: string, dto: UpdateMenuItemDto) {
    return this.write(async (tx) => {
      const before = await tx.menuItem.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new EntityNotFoundException('Menu item', id);
      await this.assertRefs(tx, dto.categoryId, dto.stationId);
      const after = await tx.menuItem.update({ where: { id }, data: dto });
      if (dto.priceMinor !== undefined && dto.priceMinor !== before.priceMinor || dto.name && dto.name !== before.name) {
        await this.audit.record(tx, {
          action: 'menu.price_change', subjectType: 'menu_item', subjectId: id,
          before: { name: before.name, priceMinor: before.priceMinor }, after: { name: after.name, priceMinor: after.priceMinor },
        });
      }
      return after;
    });
  }

  /** "86" toggle during service. Broadcast immediately to waiters. */
  async setAvailability(id: string, available: boolean) {
    const restaurantId = this.db.restaurantId;
    const item = await this.db.run(async (tx) => {
      if (!(await tx.menuItem.updateMany({ where: { id, archivedAt: null }, data: { available } })).count) throw new EntityNotFoundException('Menu item', id);
      await this.audit.record(tx, { action: 'menu.availability', subjectType: 'menu_item', subjectId: id, after: { available } });
      return tx.menuItem.findUniqueOrThrow({ where: { id }, select: { id: true, available: true } });
    });
    await this.redis.del(menuKey(restaurantId));
    this.events.emit('menu.item.availability.changed', { restaurantId, menuItemId: id, available });
    return item;
  }

  /** Archive when the item has order history (snapshots stay valid); hard delete otherwise. */
  deleteItem(id: string) {
    return this.write(async (tx) => {
      const used = await tx.orderItem.count({ where: { menuItemId: id } });
      if (used) {
        if (!(await tx.menuItem.updateMany({ where: { id }, data: { archivedAt: new Date(), available: false } })).count) throw new EntityNotFoundException('Menu item', id);
        await this.audit.record(tx, { action: 'menu.archive', subjectType: 'menu_item', subjectId: id });
        return { archived: true };
      }
      if (!(await tx.menuItem.deleteMany({ where: { id } })).count) throw new EntityNotFoundException('Menu item', id);
      return { archived: false };
    });
  }

  // ── Modifier groups & modifiers ─────────────────────────────────────────

  createGroup(menuItemId: string, dto: CreateModifierGroupDto) {
    return this.write(async (tx) => {
      if (!(await tx.menuItem.count({ where: { id: menuItemId, archivedAt: null } }))) throw new EntityNotFoundException('Menu item', menuItemId);
      const min = dto.minSelect ?? 0;
      const max = dto.maxSelect ?? 1;
      if (min > max) throw new DomainException('minSelect cannot exceed maxSelect', 'GROUP_RANGE');
      return tx.modifierGroup.create({ data: { restaurantId: rid(), menuItemId, name: dto.name, minSelect: min, maxSelect: max, sortOrder: dto.sortOrder ?? 0 } });
    });
  }

  updateGroup(id: string, dto: UpdateModifierGroupDto) {
    return this.write(async (tx) => {
      const g = await tx.modifierGroup.findFirst({ where: { id } });
      if (!g) throw new EntityNotFoundException('Modifier group', id);
      if ((dto.minSelect ?? g.minSelect) > (dto.maxSelect ?? g.maxSelect)) throw new DomainException('minSelect cannot exceed maxSelect', 'GROUP_RANGE');
      return tx.modifierGroup.update({ where: { id }, data: dto });
    });
  }

  deleteGroup(id: string) {
    return this.write(async (tx) => {
      // Cascades modifiers. Order history keeps OrderItemModifier snapshots (modifierId is informational).
      if (!(await tx.modifierGroup.deleteMany({ where: { id } })).count) throw new EntityNotFoundException('Modifier group', id);
    });
  }

  createModifier(groupId: string, dto: CreateModifierDto) {
    return this.write(async (tx) => {
      if (!(await tx.modifierGroup.count({ where: { id: groupId } }))) throw new EntityNotFoundException('Modifier group', groupId);
      return tx.modifier.create({ data: { restaurantId: rid(), groupId, name: dto.name, priceDeltaMinor: dto.priceDeltaMinor ?? 0, available: dto.available ?? true, sortOrder: dto.sortOrder ?? 0 } });
    });
  }

  updateModifier(id: string, dto: UpdateModifierDto) {
    return this.write(async (tx) => {
      if (!(await tx.modifier.updateMany({ where: { id }, data: dto })).count) throw new EntityNotFoundException('Modifier', id);
      return tx.modifier.findUniqueOrThrow({ where: { id } });
    });
  }

  deleteModifier(id: string) {
    return this.write(async (tx) => {
      if (!(await tx.modifier.deleteMany({ where: { id } })).count) throw new EntityNotFoundException('Modifier', id);
    });
  }
}
