/**
 * Onboard a restaurant (self-service org creation is disabled):
 *   pnpm --filter api provision -- --name "Daikoku" --slug daikoku --owner "Jane Doe" --email jane@example.com --password '...'
 * Creates owner user + organization + owner membership, then the Restaurant row and default stations.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { CORE_IMPORTS } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { createRestaurantForOrganization } from '../modules/auth/hooks/organization-after-create.hook.js';

@Module({ imports: [...CORE_IMPORTS] })
class ProvisionModule {}

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      owner: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  const { name, slug, owner, email, password } = values;
  if (!name || !slug || !owner || !email || !password)
    throw new Error('Required: --name --slug --owner --email --password');

  const app = await NestFactory.createApplicationContext(ProvisionModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(AuthService).provisionRestaurant(
      {
        restaurantName: name,
        slug,
        ownerName: owner,
        ownerEmail: email,
        ownerPassword: password,
      },
      createRestaurantForOrganization(app.get(PrismaService)),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
