/**
 * End-to-end smoke test against a running API (node dist/main.js).
 *   node test/smoke.e2e.mjs  [BASE=http://localhost:3000] [OWNER_EMAIL=...] [OWNER_PASSWORD=...] [OTHER_OWNER_EMAIL=...]
 * Walks a full service: devices + PIN, order → kitchen → serve → second round → void with approval →
 * bill → discount with approval → split payment → table freed, plus idempotency, permissions,
 * single-use approvals, cross-tenant isolation, PIN lockout and device revocation.
 */
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OWNER = { email: process.env.OWNER_EMAIL ?? 'owner3@servio.test', password: process.env.OWNER_PASSWORD ?? 'Owner-pass-123' };
const OTHER = { email: process.env.OTHER_OWNER_EMAIL ?? 'owner2@servio.test', password: OWNER.password };

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);

/** Tiny client: cookie session (web) or bearer (device), JSON in/out. */
function client(label) {
  const c = { label, cookie: '', bearer: '' };
  c.req = async (method, path, body, headers = {}) => {
    const h = { 'content-type': 'application/json', origin: 'http://localhost:5173', 'x-real-ip': '203.0.113.7', ...headers }; // as set by Nginx
    if (c.cookie) h.cookie = c.cookie;
    if (c.bearer) h.authorization = `Bearer ${c.bearer}`;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) c.cookie = set.map((s) => s.split(';')[0]).join('; ');
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return c;
}
const v1 = (p) => `/api/v1${p}`;

async function main() {
  // ── Owner sign-in & setup ─────────────────────────────────────────────────
  section('Owner sign-in');
  const owner = client('owner');
  let r = await owner.req('POST', '/api/auth/sign-in/email', OWNER);
  check('owner signs in', r.status === 200, r.body);
  r = await owner.req('GET', v1('/me'));
  check('session lands in restaurant (active org defaulted)', r.status === 200 && r.body.role === 'owner' && r.body.restaurantId, r.body);
  const restaurantId = r.body.restaurantId;
  check('/me lists permissions', Array.isArray(r.body.permissions) && r.body.permissions.includes('staff:manage'));

  r = await owner.req('GET', v1('/health/live').replace('/api/v1', ''));
  check('health/live is public & unprefixed', r.status === 200, r.status);

  section('Catalog & floor');
  r = await owner.req('GET', v1('/stations'));
  const grill = r.body.find((s) => s.name === 'Grill');
  const bar = r.body.find((s) => s.name === 'Bar');
  check('default stations exist', grill && bar, r.body);

  r = await owner.req('POST', v1('/categories'), { name: `Mains ${Date.now()}` });
  const cat = r.body;
  check('create category', r.status === 201, r.body);
  r = await owner.req('POST', v1('/menu-items'), { categoryId: cat.id, stationId: grill.id, name: 'Burger', priceMinor: 3500 });
  const burger = r.body;
  check('create menu item', r.status === 201, r.body);
  r = await owner.req('POST', v1(`/menu-items/${burger.id}/modifier-groups`), { name: 'Doneness', minSelect: 1, maxSelect: 1 });
  const grp = r.body;
  r = await owner.req('POST', v1(`/modifier-groups/${grp.id}/modifiers`), { name: 'Medium', priceDeltaMinor: 0 });
  const medium = r.body;
  r = await owner.req('POST', v1(`/modifier-groups/${grp.id}/modifiers`), { name: 'Extra patty', priceDeltaMinor: 1500 });
  const extra = r.body;
  check('modifier group + modifiers', medium?.id && extra?.id, r.body);
  r = await owner.req('POST', v1('/menu-items'), { categoryId: cat.id, stationId: bar.id, name: 'SP Lager', priceMinor: 1200 });
  const beer = r.body;
  r = await owner.req('POST', v1('/menu-items'), { categoryId: cat.id, stationId: grill.id, name: 'Chips', priceMinor: 800 });
  const chips = r.body;

  r = await owner.req('GET', v1('/menu'));
  const etag = r.headers.get('etag');
  check('GET /menu returns ETag', r.status === 200 && !!etag);
  r = await owner.req('GET', v1('/menu'), undefined, { 'if-none-match': etag });
  check('If-None-Match → 304', r.status === 304, r.status);

  r = await owner.req('POST', v1('/tables'), { label: `T${Date.now() % 100000}`, seats: 4 });
  const table = r.body;
  check('create table', r.status === 201, r.body);

  section('Staff, devices, PIN');
  r = await owner.req('POST', v1('/staff'), { name: 'Wendy Waiter', role: 'waiter', pin: '1111' });
  const waiterId = r.body.userId;
  check('create waiter (placeholder email, PIN only)', r.status === 201, r.body);
  r = await owner.req('POST', v1('/staff'), { name: 'Kumul Cook', role: 'kitchen', pin: '2222' });
  const cookId = r.body.userId;
  const meRes = await owner.req('GET', v1('/me'));
  const ownerId = meRes.body.user.id;
  r = await owner.req('PUT', v1(`/staff/${ownerId}/pin`), { pin: '9999' });
  check('owner sets own PIN (for approvals)', r.status === 204, r.body);

  r = await owner.req('POST', v1('/devices'), { name: 'Floor iPad' });
  const deviceToken = r.body.deviceToken;
  const deviceId = r.body.device?.id;
  check('register device returns one-time token', r.status === 201 && deviceToken?.length > 20, r.body);
  r = await owner.req('GET', v1('/devices'));
  check('device list hides token hash', r.status === 200 && r.body.every((d) => !('tokenHash' in d)));

  const device = client('device');
  r = await device.req('GET', '/api/auth/staff/roster', undefined, { 'x-device-token': deviceToken });
  check('roster via device token lists PIN staff', r.status === 200 && r.body.staff.some((s) => s.userId === waiterId), r.body);
  r = await device.req('GET', '/api/auth/staff/roster', undefined, { 'x-device-token': 'x'.repeat(43) });
  check('roster rejects unknown device', r.status === 401, r.status);

  const waiter = client('waiter');
  r = await waiter.req('POST', '/api/auth/staff/pin-login', { deviceToken, userId: waiterId, pin: '0000' });
  check('wrong PIN → 401', r.status === 401, r.status);
  r = await waiter.req('POST', '/api/auth/staff/pin-login', { deviceToken, userId: waiterId, pin: '1111' });
  check('waiter PIN login', r.status === 200 && r.body.token && r.body.role === 'waiter', r.body);
  waiter.bearer = r.body.token; waiter.cookie = '';
  r = await waiter.req('GET', v1('/me'));
  check('waiter bearer session: role + deviceId', r.status === 200 && r.body.role === 'waiter' && r.body.deviceId === deviceId, r.body);

  const kitchen = client('kitchen');
  r = await kitchen.req('POST', '/api/auth/staff/pin-login', { deviceToken, userId: cookId, pin: '2222' });
  kitchen.bearer = r.body.token; kitchen.cookie = '';
  check('kitchen PIN login', r.status === 200, r.body);

  section('Permissions');
  r = await waiter.req('POST', v1('/menu-items'), { categoryId: cat.id, stationId: grill.id, name: 'X', priceMinor: 1 });
  check('waiter cannot manage menu (403)', r.status === 403, r.status);
  r = await kitchen.req('GET', v1('/orders'));
  check('kitchen cannot list orders (403)', r.status === 403, r.status);
  r = await waiter.req('GET', v1('/reports/daily'));
  check('waiter cannot read reports (403)', r.status === 403, r.status);

  // ── Realtime ──────────────────────────────────────────────────────────────
  section('Realtime');
  const kds = io(`${BASE}/rt`, { auth: { token: kitchen.bearer }, transports: ['websocket'] });
  const kdsEvents = [];
  kds.onAny((e, p) => kdsEvents.push({ e, p }));
  await new Promise((res) => kds.once('ready', res));
  const joined = await kds.emitWithAck('station.join', { stationId: grill.id });
  check('KDS socket authenticates and joins Grill', joined?.ok === true, joined);
  const anon = io(`${BASE}/rt`, { transports: ['websocket'] });
  const anonDropped = await new Promise((res) => { anon.on('disconnect', () => res(true)); setTimeout(() => res(false), 2000); });
  check('unauthenticated socket is disconnected', anonDropped);

  // ── Order flow ────────────────────────────────────────────────────────────
  section('Order: create (idempotent) → send');
  const orderId = randomUUID();
  const idemKey = randomUUID();
  const orderBody = {
    id: orderId, type: 'DINE_IN', tableId: table.id, covers: 2,
    items: [
      { menuItemId: burger.id, qty: 2, modifierIds: [medium.id, extra.id].slice(0, 1) },
      { menuItemId: beer.id, qty: 2 },
    ],
  };
  r = await waiter.req('POST', v1('/orders'), { ...orderBody, items: [{ menuItemId: burger.id, qty: 1 }] }, { 'idempotency-key': randomUUID() });
  check('modifier min/max enforced (Doneness required)', r.status === 422 && r.body.code === 'MODIFIER_SELECTION', r.body);
  r = await waiter.req('POST', v1('/orders'), orderBody, { 'idempotency-key': idemKey });
  check('create order', r.status === 201 && r.body.id === orderId, r.body);
  // Burger 3500×2 + Lager 1200×2 = 9400, GST 10% inclusive → tax = round(9400×1000/11000) = 855
  check('server-side totals (GST-inclusive)', r.body.totals?.totalMinor === 9400 && r.body.totals?.taxMinor === 855, r.body.totals);
  const firstNumber = r.body.number;
  r = await waiter.req('POST', v1('/orders'), orderBody, { 'idempotency-key': idemKey });
  check('replay same key → same response, flagged', r.status === 201 && r.body.number === firstNumber && r.headers.get('idempotent-replayed') === 'true', r.status);
  r = await waiter.req('POST', v1('/orders'), { ...orderBody, covers: 3 }, { 'idempotency-key': idemKey });
  check('same key, different body → 409', r.status === 409, r.status);
  r = await waiter.req('POST', v1('/orders'), orderBody);
  check('missing Idempotency-Key → 400', r.status === 400, r.status);

  r = await owner.req('GET', v1('/tables'));
  check('table OCCUPIED after order', r.body.find((t) => t.id === table.id)?.status === 'OCCUPIED');

  const other = client('other-owner');
  await other.req('POST', '/api/auth/sign-in/email', OTHER);
  r = await other.req('GET', v1(`/orders/${orderId}`));
  check('other restaurant cannot see the order (404)', r.status === 404, r.status);
  r = await other.req('POST', v1(`/orders/${orderId}/send`));
  check('other restaurant cannot send it', r.status === 404, r.status);

  r = await waiter.req('POST', v1(`/orders/${orderId}/send`));
  check('send → one ticket per station', r.status === 200 && r.body.tickets?.length === 2, r.body);
  check('order SENT_TO_KITCHEN', r.body.order?.status === 'SENT_TO_KITCHEN', r.body.order?.status);
  const grillTicket = r.body.tickets.find((t) => t.stationId === grill.id);
  const barTicket = r.body.tickets.find((t) => t.stationId === bar.id);
  r = await waiter.req('POST', v1(`/orders/${orderId}/send`));
  check('send with nothing unsent → 422 (no refire)', r.status === 422 && r.body.code === 'NOTHING_TO_SEND', r.body);
  await new Promise((res) => setTimeout(res, 300));
  check('KDS got ticket.created for Grill only', kdsEvents.some((x) => x.e === 'ticket.created' && x.p.ticketId === grillTicket.id) && !kdsEvents.some((x) => x.e === 'ticket.created' && x.p.ticketId === barTicket.id), kdsEvents.map((x) => x.e));

  section('Kitchen');
  r = await kitchen.req('GET', v1(`/kitchen-tickets?station=${grill.id}`));
  check('KDS board shows the ticket with items', r.status === 200 && r.body.some((t) => t.id === grillTicket.id && t.items.length === 1), r.body);
  r = await kitchen.req('PATCH', v1(`/kitchen-tickets/${grillTicket.id}`), { status: 'SERVED' });
  check('invalid ticket transition NEW→SERVED → 422', r.status === 422, r.body);
  r = await kitchen.req('PATCH', v1(`/kitchen-tickets/${grillTicket.id}`), { status: 'PREPARING' });
  check('ticket PREPARING → order PREPARING', r.status === 200 && r.body.orderStatus === 'PREPARING', r.body);
  await kitchen.req('PATCH', v1(`/kitchen-tickets/${grillTicket.id}`), { status: 'READY' });
  r = await kitchen.req('PATCH', v1(`/kitchen-tickets/${barTicket.id}`), { status: 'READY' });
  check('all tickets READY → order READY', r.body.orderStatus === 'READY', r.body);
  await new Promise((res) => setTimeout(res, 300));
  r = await fetch(`${BASE}/health/ready`).then((x) => x.json());
  check('ticket.ready enqueued a push job', (r.details?.queue?.waiting ?? 0) + (r.details?.queue?.completed ?? 0) >= 1, r.details?.queue);
  r = await waiter.req('POST', v1(`/orders/${orderId}/serve`));
  check('serve → SERVED', r.status === 200 && r.body.status === 'SERVED', r.body?.status ?? r.body);

  section('Second round + void with approval');
  r = await waiter.req('POST', v1(`/orders/${orderId}/items`), { items: [{ menuItemId: chips.id, qty: 1 }] });
  const chipsItem = r.body.items?.find((i) => i.name === 'Chips');
  check('add item after serve', r.status === 201 && chipsItem && !chipsItem.sent, r.body);
  r = await waiter.req('POST', v1(`/orders/${orderId}/send`));
  check('round 2 fires only the new item', r.status === 200 && r.body.tickets.length === 1 && r.body.tickets[0].round === 2, r.body);
  check('order back to SENT_TO_KITCHEN', r.body.order.status === 'SENT_TO_KITCHEN', r.body.order.status);

  r = await waiter.req('POST', v1(`/orders/${orderId}/items/${chipsItem.id}/void`), { reason: 'customer changed mind' });
  check('void sent item without approval → 403', r.status === 403 && r.body.code === 'APPROVAL_REQUIRED', r.body);
  r = await device.req('POST', '/api/auth/staff/manager-approval', { deviceToken, approverId: waiterId, pin: '1111', action: 'item.void', subjectId: chipsItem.id });
  check('waiter cannot approve (403)', r.status === 403, r.status);
  r = await device.req('POST', '/api/auth/staff/manager-approval', { deviceToken, approverId: ownerId, pin: '9999', action: 'item.void', subjectId: chipsItem.id });
  const itemApproval = r.body.approvalToken;
  check('owner PIN → approval token', r.status === 200 && itemApproval, r.body);
  r = await waiter.req('POST', v1(`/orders/${orderId}/items/${burger.id}/void`), { reason: 'wrong subject' }, { 'x-approval-token': itemApproval });
  check('approval bound to subject (other id rejected)', r.status === 403 || r.status === 404, r.status);
  r = await waiter.req('POST', v1(`/orders/${orderId}/items/${chipsItem.id}/void`), { reason: 'customer changed mind' }, { 'x-approval-token': itemApproval });
  check('void with approval', r.status === 200 && r.body.items.find((i) => i.id === chipsItem.id)?.voided, r.body);
  check('ticket cancelled → order rolls back to SERVED, total unchanged', r.body.status === 'SERVED' && r.body.totals.totalMinor === 9400, { status: r.body.status, totals: r.body.totals });
  r = await waiter.req('POST', v1(`/orders/${orderId}/items/${chipsItem.id}/void`), { reason: 'again' }, { 'x-approval-token': itemApproval });
  check('approval token is single-use', r.status === 403 || r.status === 404, r.status);

  section('Billing');
  r = await waiter.req('POST', v1(`/orders/${orderId}/bill`));
  const bill = r.body;
  check('waiter creates bill', r.status === 201 && bill.totals.totalMinor === 9400 && bill.balanceMinor === 9400, r.body);
  r = await waiter.req('POST', v1(`/orders/${orderId}/bill`));
  check('second bill rejected (order already BILLED → 422)', r.status === 422 && r.body.code === 'INVALID_STATE', r.body);
  r = await waiter.req('POST', v1(`/orders/${orderId}/items`), { items: [{ menuItemId: chips.id, qty: 1 }] });
  check('items locked once BILLED', r.status === 422, r.status);

  r = await device.req('POST', '/api/auth/staff/manager-approval', { deviceToken, approverId: ownerId, pin: '9999', action: 'bill.discount', subjectId: bill.id });
  const discApproval = r.body.approvalToken;
  r = await waiter.req('POST', v1(`/bills/${bill.id}/discount`), { percentBps: 1000, reason: 'birthday' }, { 'x-approval-token': discApproval });
  check('waiter lacks bill:discount even with token (403)', r.status === 403, r.status);
  r = await owner.req('POST', v1(`/bills/${bill.id}/discount`), { percentBps: 1000, reason: 'birthday' }, { 'x-approval-token': discApproval });
  check('10% discount → 8460 total, tax recomputed', r.status === 201 && r.body.totals.totalMinor === 8460 && r.body.totals.taxMinor === 769, r.body.totals ?? r.body);

  r = await waiter.req('POST', v1(`/bills/${bill.id}/payments`), { method: 'CARD', amountMinor: 100 }, { 'idempotency-key': randomUUID() });
  check('waiter cannot take payment (403)', r.status === 403, r.status);
  const payKey = randomUUID();
  r = await owner.req('POST', v1(`/bills/${bill.id}/payments`), { method: 'CARD', amountMinor: 5000, reference: 'slip-123' }, { 'idempotency-key': payKey });
  check('partial card payment', r.status === 201 && r.body.balanceMinor === 3460 && !r.body.paidInFull, r.body);
  r = await owner.req('POST', v1(`/bills/${bill.id}/payments`), { method: 'CARD', amountMinor: 5000, reference: 'slip-123' }, { 'idempotency-key': payKey });
  check('retried payment is NOT recorded twice', r.status === 201 && r.body.balanceMinor === 3460, r.body);
  r = await owner.req('POST', v1(`/bills/${bill.id}/payments`), { method: 'CASH', amountMinor: 9999 }, { 'idempotency-key': randomUUID() });
  check('overpayment → 422', r.status === 422 && r.body.code === 'OVERPAYMENT', r.body);
  r = await owner.req('POST', v1(`/bills/${bill.id}/payments`), { method: 'CASH', amountMinor: 3460, tenderedMinor: 5000 }, { 'idempotency-key': randomUUID() });
  check('cash settles bill, change 1540', r.status === 201 && r.body.paidInFull && r.body.changeMinor === 1540, r.body);

  r = await owner.req('GET', v1(`/orders/${orderId}`));
  check('order PAID & closed', r.body.status === 'PAID' && r.body.closedAt, r.body.status);
  r = await owner.req('GET', v1('/tables'));
  check('table FREE again', r.body.find((t) => t.id === table.id)?.status === 'FREE');
  r = await owner.req('GET', v1(`/bills/${bill.id}`));
  check('bill PAID, 2 payments, approver recorded', r.body.status === 'PAID' && r.body.payments.length === 2 && r.body.discount?.approvedBy === 'Gideon Owner', r.body);

  section('Void whole order (approval) + cancel');
  const o2 = randomUUID();
  await waiter.req('POST', v1('/orders'), { id: o2, type: 'TAKEAWAY', items: [{ menuItemId: beer.id, qty: 1 }] }, { 'idempotency-key': randomUUID() });
  await waiter.req('POST', v1(`/orders/${o2}/send`));
  r = await owner.req('POST', v1(`/orders/${o2}/void`), { reason: 'walked out' });
  check('void without token → 403', r.status === 403, r.status);
  r = await device.req('POST', '/api/auth/staff/manager-approval', { deviceToken, approverId: ownerId, pin: '9999', action: 'order.void', subjectId: o2 });
  r = await owner.req('POST', v1(`/orders/${o2}/void`), { reason: 'walked out' }, { 'x-approval-token': r.body.approvalToken });
  check('order VOIDED, tickets cancelled', r.status === 200 && r.body.status === 'VOIDED' && r.body.tickets.every((t) => t.status === 'CANCELLED'), r.body);
  const o3 = randomUUID();
  await waiter.req('POST', v1('/orders'), { id: o3, type: 'TAKEAWAY', items: [{ menuItemId: beer.id, qty: 1 }] }, { 'idempotency-key': randomUUID() });
  r = await waiter.req('POST', v1(`/orders/${o3}/cancel`), {});
  check('unsent order cancels without approval', r.status === 201 && r.body.status === 'CANCELLED', r.body);

  section('Reports & audit');
  r = await owner.req('GET', v1('/reports/daily'));
  check('daily report: ≥1 paid order incl. 8460', r.status === 200 && r.body.ordersCount >= 1 && r.body.totalMinor >= 8460 && r.body.byMethod.CASH >= 3460, r.body);
  r = await owner.req('GET', v1(`/reports/top-items?from=${r.body.businessDate}&to=${r.body.businessDate}`));
  check('top items includes Burger', r.status === 200 && r.body.some((i) => i.name === 'Burger'), r.body);
  const today = (await owner.req('GET', v1('/settings/restaurant'))).body.businessDate;
  r = await owner.req('GET', v1(`/reports/voids?from=${today}&to=${today}`));
  check('voids report shows approver names', r.status === 200 && r.body.some((v) => v.action === 'order.void' && v.approver === 'Gideon Owner'), r.body);
  r = await owner.req('GET', v1('/audit-logs?action=bill.discount'));
  check('audit log has the discount with approver', r.status === 200 && r.body.items.some((a) => a.approverId === ownerId), r.body);

  section('Security: lockout & device revocation');
  const victim = client('victim');
  let last;
  for (let i = 0; i < 6; i++) last = await victim.req('POST', '/api/auth/staff/pin-login', { deviceToken, userId: cookId, pin: '0000' });
  check('PIN lockout / rate limit after repeated failures (429)', last.status === 429, last.status);

  const kdsDropped = new Promise((res) => { kds.on('disconnect', () => res(true)); setTimeout(() => res(false), 3000); });
  r = await owner.req('POST', v1(`/devices/${deviceId}/revoke`));
  check('revoke device', r.status === 204, r.body);
  r = await waiter.req('GET', v1('/me'));
  check('revoked device session rejected immediately (401)', r.status === 401, r.status);
  check('revoked device sockets disconnected', await kdsDropped);
  r = await device.req('GET', '/api/auth/staff/roster', undefined, { 'x-device-token': deviceToken });
  check('revoked device token rejected', r.status === 401, r.status);

  kds.close(); anon.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
