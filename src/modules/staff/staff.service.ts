import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  FLOOR_ROLES,
  type RequestSession,
} from '../../common/types/tx.type.js';
import { DomainException } from '../../common/exceptions/domain.exceptions.js';
import { TenantPrismaService } from '../../database/tenant-prisma.service.js';
import { AuditService } from '../../infrastructure/audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto.js';

/** Admin rules on top of AuthService (which owns the writes). Every change is audited. */
@Injectable()
export class StaffService {
  constructor(
    private readonly auth: AuthService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(s: RequestSession) {
    return this.auth.listStaff(s.restaurantId);
  }

  async create(s: RequestSession, dto: CreateStaffDto) {
    const created = await this.auth.createStaff(s.restaurantId, dto);
    await this.audit$(s, 'staff.create', created.userId, {
      role: dto.role,
      name: dto.name,
    });
    return created;
  }

  async update(s: RequestSession, userId: string, dto: UpdateStaffDto) {
    const member = await this.auth.getMember(s.restaurantId, userId);
    if (dto.role && dto.role !== member.role) {
      if (userId === s.userId)
        throw new DomainException(
          'You cannot change your own role',
          'SELF_ROLE_CHANGE',
        );
      if (
        member.role === 'owner' &&
        (await this.auth.countOwners(s.restaurantId)) <= 1
      ) {
        throw new DomainException(
          'A restaurant must keep at least one owner',
          'LAST_OWNER',
        );
      }
    }
    await this.auth.updateStaff(s.restaurantId, userId, dto);
    await this.audit$(s, 'staff.update', userId, {
      before: { role: member.role },
      after: { ...dto },
    });
  }

  async deactivate(s: RequestSession, userId: string) {
    if (userId === s.userId)
      throw new DomainException(
        'You cannot deactivate yourself',
        'SELF_DEACTIVATE',
      );
    const member = await this.auth.getMember(s.restaurantId, userId);
    if (
      member.role === 'owner' &&
      (await this.auth.countOwners(s.restaurantId)) <= 1
    ) {
      throw new DomainException(
        'A restaurant must keep at least one owner',
        'LAST_OWNER',
      );
    }
    await this.auth.deactivateStaff(s.restaurantId, userId);
    await this.audit$(s, 'staff.deactivate', userId, { role: member.role });
  }

  /** Owner: anyone. Manager: floor roles only (waiter/kitchen/cashier) and themselves. */
  async setPin(s: RequestSession, userId: string, pin: string) {
    const target = await this.auth.getMember(s.restaurantId, userId);
    const allowed =
      s.role === 'owner' ||
      (s.role === 'manager' &&
        (userId === s.userId || FLOOR_ROLES.includes(target.role as never)));
    if (!allowed) throw new ForbiddenException('Not allowed to set this PIN');
    await this.auth.setPin(s.restaurantId, userId, pin);
    await this.audit$(s, 'staff.pin_set', userId, {});
  }

  listDevices(s: RequestSession) {
    return this.auth.listDevices(s.restaurantId);
  }

  async registerDevice(s: RequestSession, name: string) {
    const result = await this.auth.registerDevice(
      s.restaurantId,
      name,
      s.userId,
    );
    await this.audit$(s, 'device.register', result.device.id, { name });
    return result;
  }

  async revokeDevice(s: RequestSession, deviceId: string) {
    await this.auth.revokeDevice(s.restaurantId, deviceId);
    await this.audit$(s, 'device.revoke', deviceId, {});
  }

  private audit$(
    s: RequestSession,
    action: string,
    subjectId: string,
    after: Record<string, unknown>,
  ) {
    return this.db.run((tx) =>
      this.audit.record(tx, {
        action,
        subjectType: action.startsWith('device') ? 'device' : 'user',
        subjectId,
        after: after as never,
        userId: s.userId,
      }),
    );
  }
}
