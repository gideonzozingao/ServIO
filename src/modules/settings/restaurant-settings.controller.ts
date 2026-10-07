import { RequirePermission } from './../../common/decorators/require-permission/require-permission.decorator.js';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RestaurantSettingsService } from './restaurant-settings.service.js';
import { UpdateRestaurantSettingsDto } from './dto/settings.dto.js';

@ApiTags('settings')
@Controller('settings/restaurant')
export class RestaurantSettingsController {
  constructor(private readonly settings: RestaurantSettingsService) {}

  @Get()
  async get() {
    return {
      ...(await this.settings.get()),
      businessDate: (await this.settings.businessDate()).iso,
    };
  }

  @Patch()
  @RequirePermission('settings', 'manage')
  update(@Body() dto: UpdateRestaurantSettingsDto) {
    return this.settings.update(dto);
  }
}
