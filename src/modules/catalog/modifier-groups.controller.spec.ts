import { Test, TestingModule } from '@nestjs/testing';
import { ModifierGroupsController } from './modifier-groups.controller.js';

describe('ModifierGroupsController', () => {
  let controller: ModifierGroupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModifierGroupsController],
    }).compile();

    controller = module.get<ModifierGroupsController>(ModifierGroupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
