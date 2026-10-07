import { Test, TestingModule } from '@nestjs/testing';
import { DomainEvents } from './domain-events.service.js';

describe('DomainEvents', () => {
  let service: DomainEvents;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DomainEvents],
    }).compile();

    service = module.get<DomainEvents>(DomainEvents);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
