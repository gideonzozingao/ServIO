import { Test, TestingModule } from '@nestjs/testing';
import { MenuItemsController } from './menu-items.controller.js';

describe('MenuItemsController', () => {
  let controller: MenuItemsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MenuItemsController],
    }).compile();

    controller = module.get<MenuItemsController>(MenuItemsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
