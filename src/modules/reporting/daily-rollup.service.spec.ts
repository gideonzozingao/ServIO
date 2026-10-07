import { Test, TestingModule } from '@nestjs/testing';
import { DailyRollupService } from './daily-rollup.service.js';

describe('DailyRollupService', () => {
  let service: DailyRollupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DailyRollupService],
    }).compile();

    service = module.get<DailyRollupService>(DailyRollupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
