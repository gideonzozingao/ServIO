import { Test, TestingModule } from '@nestjs/testing';
import { TicketQueryService } from './ticket-query.service.js';

describe('TicketQueryService', () => {
  let service: TicketQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketQueryService],
    }).compile();

    service = module.get<TicketQueryService>(TicketQueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
