import { Test, TestingModule } from '@nestjs/testing';
import { DomainEventsService } from './domain-events.service.js';

describe('DomainEventsService', () => {
  let service: DomainEventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DomainEventsService],
    }).compile();

    service = module.get<DomainEventsService>(DomainEventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
