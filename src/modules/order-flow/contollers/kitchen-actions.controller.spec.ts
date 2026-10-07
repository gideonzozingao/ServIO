import { Test, TestingModule } from '@nestjs/testing';
import { KitchenActionsController } from './kitchen-actions.controller.js';

describe('KitchenActionsController', () => {
  let controller: KitchenActionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KitchenActionsController],
    }).compile();

    controller = module.get<KitchenActionsController>(KitchenActionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
