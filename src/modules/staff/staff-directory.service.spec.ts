import { Test, TestingModule } from '@nestjs/testing';
import { StaffDirectoryService } from './staff-directory.service.js';

describe('StaffDirectoryService', () => {
  let service: StaffDirectoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StaffDirectoryService],
    }).compile();

    service = module.get<StaffDirectoryService>(StaffDirectoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
