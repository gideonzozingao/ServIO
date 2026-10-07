import { withTenant } from '../../../database/with-tenant.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import { rid } from '../../../database/tenant-scope.js';

export const DEFAULT_STATIONS = ['Grill', 'Fry', 'Cold', 'Bar'];

/**
 * organization.afterCreate → Restaurant row with the same id + default stations.
 * Runs on the APP client inside withTenant so RLS WITH CHECK applies.
 */
export function createRestaurantForOrganization(prisma: PrismaService) {
  return async (organizationId: string): Promise<void> => {
    await withTenant(prisma, organizationId, async (tx) => {
      await tx.restaurant.upsert({ where: { id: organizationId }, create: { id: organizationId }, update: {} });
      await tx.station.createMany({
        data: DEFAULT_STATIONS.map((name, i) => ({ restaurantId: rid(), name, sortOrder: i })),
        skipDuplicates: true,
      });
    });
  };
}
