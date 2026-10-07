import { Module } from '@nestjs/common';
import { FloorService } from './floor.service.js';
import { TablesController } from './tables.controller.js';

@Module({ controllers: [TablesController], providers: [FloorService], exports: [FloorService] })
export class FloorModule {}
