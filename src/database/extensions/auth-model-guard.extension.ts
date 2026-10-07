import { Prisma } from '../prisma-client.js';

/** Better Auth owns these tables. The app client may read them, never write. */
export const AUTH_MODELS = new Set<string>([
  'User', 'Session', 'Account', 'Verification', 'Organization', 'Member', 'Invitation',
  'Device', 'StaffPin', 'ManagerApproval',
]);

const WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany',
]);

/**
 * Applied to the app client only. Better Auth uses its own AuthPrismaClient (separate DB role),
 * so there is no "unless called from auth" escape hatch to get wrong.
 */
export const authModelGuardExtension = Prisma.defineExtension({
  name: 'servio-auth-model-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (AUTH_MODELS.has(model) && WRITE_OPS.has(operation)) {
          throw new Error(`Writes to Better Auth model "${model}" must go through the auth module`);
        }
        return query(args);
      },
    },
  },
});
