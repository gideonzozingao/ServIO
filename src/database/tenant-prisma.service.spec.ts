import { Test, TestingModule } from '@nestjs/testing';
import { TenantPrismaService } from './tenant-prisma.service.js';

describe('TenantPrismaService', () => {
  let service: TenantPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantPrismaService],
    }).compile();

    service = module.get<TenantPrismaService>(TenantPrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
