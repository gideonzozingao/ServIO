import { APIError, createAuthEndpoint } from 'better-auth/api';
import { listRoster, resolveDevice } from '../staff-device.core.js';

/** GET /api/auth/staff/roster  (header X-Device-Token) → staff tiles for the device's restaurant. */
export const rosterEndpoint = () =>
  createAuthEndpoint(
    '/staff/roster',
    { method: 'GET', requireHeaders: true },
    async (ctx) => {
      const device = await resolveDevice(
        ctx.context,
        ctx.headers?.get('x-device-token'),
      );
      if (!device)
        throw new APIError('UNAUTHORIZED', {
          message: 'Unknown or revoked device',
        });
      return ctx.json({
        restaurantId: device.organizationId,
        deviceName: device.name,
        staff: await listRoster(ctx.context, device.organizationId),
      });
    },
  );
