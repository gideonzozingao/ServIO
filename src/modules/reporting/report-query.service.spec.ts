import { Test, TestingModule } from '@nestjs/testing';
import { ReportQueryService } from './report-query.service.js';

describe('ReportQueryService', () => {
  let service: ReportQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportQueryService],
    }).compile();

    service = module.get<ReportQueryService>(ReportQueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
