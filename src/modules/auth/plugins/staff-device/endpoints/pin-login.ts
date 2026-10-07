import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import {
  checkPin,
  findMember,
  resolveDevice,
  type StaffDeviceOptions,
} from '../staff-device.core.js';

const Body = z.object({
  deviceToken: z.string().min(20),
  userId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/),
});

/**
 * POST /api/auth/staff/pin-login
 * Device fixes the restaurant; session gets activeOrganizationId + deviceId and a shift-length expiry.
 * Sets the cookie (web) and returns the token (bearer plugin / Expo).
 */
export const pinLoginEndpoint = (opts: StaffDeviceOptions) =>
  createAuthEndpoint(
    '/staff/pin-login',
    { method: 'POST', body: Body },
    async (ctx) => {
      const generic = new APIError('UNAUTHORIZED', {
        message: 'Invalid credentials',
      });
      const device = await resolveDevice(ctx.context, ctx.body.deviceToken);
      if (!device)
        throw new APIError('UNAUTHORIZED', {
          message: 'Unknown or revoked device',
        });

      const member = await findMember(
        ctx.context,
        device.organizationId,
        ctx.body.userId,
      );
      if (!member) throw generic;

      const result = await checkPin(ctx.context, opts, {
        organizationId: device.organizationId,
        userId: member.userId,
        pin: ctx.body.pin,
      });
      if (result === 'locked')
        throw new APIError('TOO_MANY_REQUESTS', {
          message: 'Too many attempts. Try again later.',
        });
      if (result !== 'ok') throw generic;

      const user = await ctx.context.internalAdapter.findUserById(
        member.userId,
      );
      if (!user) throw generic;

      const expiresAt = new Date(
        Date.now() + opts.staffSessionHours * 3_600_000,
      );
      const session = await ctx.context.internalAdapter.createSession(
        user.id,
        false,
        {
          activeOrganizationId: device.organizationId,
          deviceId: device.id,
          expiresAt,
        },
      );
      if (!session)
        throw new APIError('INTERNAL_SERVER_ERROR', {
          message: 'Could not create session',
        });

      await ctx.context.adapter.update({
        model: 'device',
        where: [{ field: 'id', value: device.id }],
        update: { lastSeenAt: new Date() },
      });
      await setSessionCookie(ctx, { session, user });

      return ctx.json({
        token: session.token,
        expiresAt,
        user: { id: user.id, name: user.name },
        role: member.role,
        restaurantId: device.organizationId,
      });
    },
  );
