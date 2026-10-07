import { Test, TestingModule } from '@nestjs/testing';
import { OrderPricingService } from './order-pricing.service.js';

describe('OrderPricingService', () => {
  let service: OrderPricingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderPricingService],
    }).compile();

    service = module.get<OrderPricingService>(OrderPricingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
