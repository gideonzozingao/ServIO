import { Test, TestingModule } from '@nestjs/testing';
import { MenuQueryService } from './menu-query.service.js';

describe('MenuQueryService', () => {
  let service: MenuQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MenuQueryService],
    }).compile();

    service = module.get<MenuQueryService>(MenuQueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
