import { Test, TestingModule } from '@nestjs/testing';
import { OrderActionsController } from './order-actions.controller.js';

describe('OrderActionsController', () => {
  let controller: OrderActionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderActionsController],
    }).compile();

    controller = module.get<OrderActionsController>(OrderActionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
