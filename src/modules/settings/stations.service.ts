import { Injectable } from '@nestjs/common';
import { EntityNotFoundException } from '../../common/exceptions/domain.exceptions.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { rid } from '../../database/tenant-scope.js';
import { DomainEvents } from '../../infrastructure/events/domain-events.service.js';
import type { CreateStationDto, UpdateStationDto } from './dto/settings.dto.js';

@Injectable()
export class StationsService {
  constructor(private readonly db: TenantPrismaService, private readonly events: DomainEvents) {}

  list(includeInactive = false) {
    return this.db.run((tx) => tx.station.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
  }

  create(dto: CreateStationDto) {
    return this.db.run((tx) => tx.station.create({ data: { restaurantId: rid(), name: dto.name, sortOrder: dto.sortOrder ?? 0 } }));
  }

  async update(id: string, dto: UpdateStationDto) {
    const station = await this.db.run(async (tx) => {
      const n = await tx.station.updateMany({ where: { id }, data: dto });
      if (!n.count) throw new EntityNotFoundException('Station', id);
      return tx.station.findUniqueOrThrow({ where: { id } });
    });
    this.events.emit('menu.updated', { restaurantId: station.restaurantId });
    return station;
  }

  /** Deactivate when referenced by menu items or tickets; hard delete otherwise. */
  async remove(id: string) {
    return this.db.run(async (tx) => {
      const items = await tx.menuItem.count({ where: { stationId: id } });
      const tickets = await tx.kitchenTicket.count({ where: { stationId: id } });
      if (items || tickets) {
        const n = await tx.station.updateMany({ where: { id }, data: { active: false } });
        if (!n.count) throw new EntityNotFoundException('Station', id);
        return { deleted: false, deactivated: true };
      }
      const n = await tx.station.deleteMany({ where: { id } });
      if (!n.count) throw new EntityNotFoundException('Station', id);
      return { deleted: true, deactivated: false };
    });
  }
}
