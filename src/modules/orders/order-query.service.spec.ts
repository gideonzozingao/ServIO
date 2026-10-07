import { Test, TestingModule } from '@nestjs/testing';
import { OrderQueryService } from './order-query.service.js';

describe('OrderQueryService', () => {
  let service: OrderQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderQueryService],
    }).compile();

    service = module.get<OrderQueryService>(OrderQueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
