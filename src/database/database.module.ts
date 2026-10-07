import { Global, Module } from '@nestjs/common';
import { TenancyModule } from '../infrastructure/tenancy/tenancy.module.js';
import { AuthPrismaClient } from './auth-prisma.client.js';
import { DocumentNumberService } from './document-number.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Global()
@Module({
  imports: [TenancyModule],
  providers: [PrismaService, AuthPrismaClient, TenantPrismaService, DocumentNumberService],
  exports: [PrismaService, AuthPrismaClient, TenantPrismaService, DocumentNumberService],
})
export class DatabaseModule {}