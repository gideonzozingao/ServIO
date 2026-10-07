import { Test, TestingModule } from '@nestjs/testing';
import { BillActionsController } from './bill-actions.controller.js';

describe('BillActionsController', () => {
  let controller: BillActionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillActionsController],
    }).compile();

    controller = module.get<BillActionsController>(BillActionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
