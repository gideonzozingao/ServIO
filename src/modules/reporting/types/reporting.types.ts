export interface DailyFigures {
  businessDate: string;
  ordersCount: number;
  grossMinor: number; // Σ subtotal (menu prices) of PAID orders
  discountMinor: number;
  taxMinor: number;
  netMinor: number; // collected excl. tax
  totalMinor: number; // collected incl. tax
  voidsCount: number; // voided lines (incl. lines of voided orders)
  voidsMinor: number;
  byMethod: Record<string, number>;
}
