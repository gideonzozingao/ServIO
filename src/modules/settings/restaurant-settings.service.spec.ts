import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantSettingsService } from './restaurant-settings.service.js';

describe('RestaurantSettingsService', () => {
  let service: RestaurantSettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RestaurantSettingsService],
    }).compile();

    service = module.get<RestaurantSettingsService>(RestaurantSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
