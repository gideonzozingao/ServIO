export const QUEUES = {
  reports: 'reports',
  maintenance: 'maintenance',
  notifications: 'notifications',
} as const;

export const JOBS = {
  dailyRollup: 'daily-rollup',
  cleanup: 'cleanup',
  pushTicketReady: 'push.ticket-ready',
} as const;

export interface DailyRollupJob {
  restaurantId?: string; // omit → all restaurants
  date?: string; // YYYY-MM-DD; omit → previous business date per restaurant
}

export interface PushTicketReadyJob {
  restaurantId: string;
  waiterId: string;
  orderId: string;
  orderNumber: number;
  tableLabel: string | null;
}
