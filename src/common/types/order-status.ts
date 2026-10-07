import { OrderStatus } from '../../database/prisma-client.js';

const S = OrderStatus;
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [S.PAID, S.CANCELLED, S.VOIDED];
export const OPEN_ORDER_STATUSES: OrderStatus[] = Object.values(S).filter((s) => !TERMINAL_ORDER_STATUSES.includes(s));
/** Statuses where items can still be added (a new round is fired on the next send). */
export const EDITABLE_ORDER_STATUSES: OrderStatus[] = [S.OPEN, S.SENT_TO_KITCHEN, S.PREPARING, S.READY, S.SERVED];
export const BILLABLE_ORDER_STATUSES: OrderStatus[] = [S.READY, S.SERVED];
