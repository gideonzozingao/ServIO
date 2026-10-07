import { Module } from '@nestjs/common';
import { RestaurantSettingsController } from './restaurant-settings.controller.js';
import { RestaurantSettingsService } from './restaurant-settings.service.js';
import { StationsController } from './stations.controller.js';
import { StationsService } from './stations.service.js';

@Module({
  controllers: [RestaurantSettingsController, StationsController],
  providers: [RestaurantSettingsService, StationsService],
  exports: [RestaurantSettingsService, StationsService],
})
export class SettingsModule {}
