import { Test, TestingModule } from '@nestjs/testing';
import { KitchenTicketsController } from './kitchen-tickets.controller.js';

describe('KitchenTicketsController', () => {
  let controller: KitchenTicketsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KitchenTicketsController],
    }).compile();

    controller = module.get<KitchenTicketsController>(KitchenTicketsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
