import { TaxRule } from './../../../common/money/tax.util.js';

export interface RestaurantSettings extends TaxRule {
  restaurantId: string;
  currency: string;
  timezone: string;
  dayRolloverHour: number;
}
