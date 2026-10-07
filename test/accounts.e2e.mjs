/**
 * E2E for registration, invitations and account self-service (run against a NON-production API:
 * it reads verification/invitation links from the dev mail outbox in Redis).
 *   node test/accounts.e2e.mjs   [BASE] [REDIS_URL] [EXISTING_OWNER_EMAIL] [EXISTING_OWNER_PASSWORD]
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const EXISTING = { email: process.env.EXISTING_OWNER_EMAIL ?? 'owner3@servio.test', password: process.env.EXISTING_OWNER_PASSWORD ?? 'Owner-pass-123' };
const run = Date.now().toString(36);
// Each simulated device gets its own IP, like real clients (rate limits are per IP).
const randomIp = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

let passed = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

function client() {
  const c = { cookie: '', bearer: '', ip: randomIp() };
  c.req = async (method, path, body, headers = {}) => {
    const h = { 'content-type': 'application/json', origin: 'http://localhost:5173', 'x-real-ip': c.ip, 'x-forwarded-for': c.ip, ...headers };
    if (c.cookie) h.cookie = c.cookie;
    if (c.bearer) h.authorization = `Bearer ${c.bearer}`;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) c.cookie = set.map((s) => s.split(';')[0]).join('; ');
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  c.signIn = (email, password) => c.req('POST', '/api/auth/sign-in/email', { email, password });
  return c;
}
const v1 = (p) => `/api/v1${p}`;
const outbox = async (email) => (await redis.lrange(`dev:outbox:${email}`, 0, -1)).map((x) => JSON.parse(x));
const lastMail = async (email, kind) => (await outbox(email)).find((m) => !kind || m.kind === kind);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── Owner self sign-up ────────────────────────────────────────────────────
  section('Owner self sign-up');
  const ownerEmail = `founder-${run}@servio.test`;
  const owner = client();
  let r = await owner.req('POST', v1('/registration'), { restaurantName: `Kokoda Grill ${run}`, ownerName: 'Fiona Founder', email: ownerEmail, password: 'short' });
  check('weak password rejected (400)', r.status === 400, r.body);
  r = await owner.req('POST', v1('/registration'), { restaurantName: `Kokoda Grill ${run}`, ownerName: 'Fiona Founder', email: ownerEmail, password: 'Founder-pass-123' });
  const accepted = r.body;
  check('register → 202 pending_verification', r.status === 202 && r.body.status === 'pending_verification', r.body);
  check('response does not leak ids', !JSON.stringify(r.body).match(/[0-9a-f]{8}-[0-9a-f]{4}/));

  await sleep(200);
  const verify = await lastMail(ownerEmail, 'verify-email');
  check('verification email sent with link', verify?.link?.includes('/api/auth/verify-email'), await outbox(ownerEmail));

  r = await owner.signIn(ownerEmail, 'Founder-pass-123');
  check('sign-in blocked until verified (403)', r.status === 403, r.body);

  const vurl = new URL(verify.link);
  r = await owner.req('GET', vurl.pathname + vurl.search);
  check('verification link redirects to app', r.status === 302 && (r.headers.get('location') ?? '').startsWith('http://localhost:5173/login'), { status: r.status, loc: r.headers.get('location') });

  r = await owner.signIn(ownerEmail, 'Founder-pass-123');
  check('sign-in after verification', r.status === 200, r.body);
  r = await owner.req('GET', v1('/me'));
  check('owner of the new restaurant', r.status === 200 && r.body.role === 'owner', r.body);
  const restaurantId = r.body.restaurantId;
  const ownerId = r.body.user.id;
  r = await owner.req('GET', v1('/stations'));
  check('restaurant provisioned with default stations', r.status === 200 && r.body.length === 4, r.body);

  const dup = client();
  r = await dup.req('POST', v1('/registration'), { restaurantName: 'Copycat Diner', ownerName: 'Mallory', email: ownerEmail, password: 'Mallory-pass-123' });
  check('duplicate email → identical 202 (no account probing)', r.status === 202 && JSON.stringify(r.body) === JSON.stringify(accepted), r.body);
  await sleep(200);
  check('...and the real owner gets an "account exists" email', (await lastMail(ownerEmail))?.kind === 'account-exists');
  r = await owner.req('GET', v1('/account'));
  check('...and no second restaurant was created', r.body.restaurants.length === 1, r.body.restaurants);

  r = await dup.req('GET', v1(`/registration/slugs/${r.body.restaurants[0].slug}`));
  check('slug availability: taken', r.status === 200 && r.body.available === false, r.body);
  r = await dup.req('POST', v1('/registration'), { restaurantName: 'X Bar', slug: r.body.slug, ownerName: 'Xavier', email: `x-${run}@servio.test`, password: 'Xavier-pass-123' });
  check('explicit taken slug → 409 SLUG_TAKEN', r.status === 409 && r.body.code === 'SLUG_TAKEN', r.body);

  // ── Invitations ───────────────────────────────────────────────────────────
  section('Invitations');
  const mgrEmail = `manager-${run}@servio.test`;
  r = await owner.req('POST', v1('/invitations'), { email: mgrEmail, role: 'waiter' });
  check('floor roles cannot be invited by email (400)', r.status === 400, r.body);
  r = await owner.req('POST', v1('/invitations'), { email: mgrEmail.toUpperCase(), role: 'manager' });
  const inv = r.body;
  check('owner invites a manager', r.status === 201 && inv.status === 'pending' && inv.email === mgrEmail, r.body);
  r = await owner.req('POST', v1('/invitations'), { email: mgrEmail, role: 'manager' });
  check('re-invite refreshes the same invitation', r.status === 201 && r.body.id === inv.id, r.body);
  r = await owner.req('GET', v1('/invitations?status=pending'));
  check('list shows one pending invitation with inviter', r.body.length === 1 && r.body[0].invitedBy === 'Fiona Founder', r.body);
  await sleep(200);
  const invMail = await lastMail(mgrEmail, 'invitation');
  check('invitation email carries the link', invMail?.link?.endsWith(`/invite/${inv.id}`), invMail);

  const mgr = client();
  r = await mgr.req('GET', v1(`/registration/invitations/${inv.id}`));
  check('public preview shows restaurant + role', r.status === 200 && r.body.role === 'manager' && r.body.restaurantName.startsWith('Kokoda Grill') && r.body.accountExists === false, r.body);
  r = await mgr.req('POST', v1(`/registration/invitations/${inv.id}/accept`), { name: 'Max Manager', password: 'Manager-pass-123' });
  check('accept as new user', r.status === 201 && r.body.status === 'accepted', r.body);
  r = await mgr.req('POST', v1(`/registration/invitations/${inv.id}/accept`), { name: 'Max Again', password: 'Manager-pass-123' });
  check('invitation is single-use (410)', r.status === 410, r.body);
  r = await mgr.signIn(mgrEmail, 'Manager-pass-123');
  check('invited manager signs in immediately (email proven by link)', r.status === 200, r.body);
  r = await mgr.req('GET', v1('/me'));
  check('manager role in the inviting restaurant', r.body.role === 'manager' && r.body.restaurantId === restaurantId, r.body);
  r = await mgr.req('POST', v1('/invitations'), { email: `x-${run}@servio.test`, role: 'manager' });
  check('manager cannot invite (owner-only, 403)', r.status === 403, r.status);

  r = await owner.req('POST', v1('/invitations'), { email: `cancelme-${run}@servio.test`, role: 'manager' });
  const cancelId = r.body.id;
  r = await owner.req('DELETE', v1(`/invitations/${cancelId}`));
  check('cancel invitation', r.status === 204, r.body);
  r = await mgr.req('GET', v1(`/registration/invitations/${cancelId}`));
  check('cancelled invitation → 410', r.status === 410 && r.body.code === 'INVITATION_CLOSED', r.body);

  section('Invite an existing account (multi-restaurant)');
  const existing = client();
  r = await existing.signIn(EXISTING.email, EXISTING.password);
  check('existing owner of another restaurant signs in', r.status === 200, r.body);
  const homeRestaurant = (await existing.req('GET', v1('/me'))).body.restaurantId;
  r = await owner.req('POST', v1('/invitations'), { email: EXISTING.email, role: 'owner' });
  const coInv = r.body;
  r = await existing.req('POST', v1(`/registration/invitations/${coInv.id}/accept`), { name: 'Nope', password: 'Whatever-pass-1' });
  check('public accept refused for existing account (409 ACCOUNT_EXISTS)', r.status === 409 && r.body.code === 'ACCOUNT_EXISTS', r.body);
  r = await mgr.req('POST', v1(`/account/invitations/${coInv.id}/accept`));
  check('someone else cannot accept it (403 mismatch)', r.status === 403 && r.body.code === 'INVITATION_EMAIL_MISMATCH', r.body);
  r = await existing.req('GET', v1('/account/invitations'));
  check('invitee sees it in /account/invitations', r.status === 200 && r.body.some((i) => i.id === coInv.id), r.body);
  r = await existing.req('POST', v1(`/account/invitations/${coInv.id}/accept`));
  check('accept while signed in', r.status === 200 && r.body.restaurantId === restaurantId, r.body);
  r = await existing.req('GET', v1('/account'));
  check('/account lists the new restaurant alongside the original', r.body.restaurants.length >= 2 && r.body.restaurants.some((x) => x.restaurantId === restaurantId && x.role === 'owner'), r.body.restaurants);
  r = await existing.req('POST', v1('/account/active-restaurant'), { restaurantId });
  check('switch active restaurant', r.status === 200 && r.body.role === 'owner', r.body);
  r = await existing.req('GET', v1('/me'));
  check('/me now acts on the new restaurant', r.body.restaurantId === restaurantId && r.body.role === 'owner', r.body);
  r = await mgr.req('POST', v1('/account/active-restaurant'), { restaurantId: homeRestaurant });
  check('cannot switch into a restaurant you are not a member of', r.status === 403 && r.body.code === 'NOT_A_MEMBER', r.body);
  await existing.req('POST', v1('/account/active-restaurant'), { restaurantId: homeRestaurant });
  r = await existing.req('GET', v1('/me'));
  check('switch back', r.body.restaurantId === homeRestaurant);

  // ── Account self-service ──────────────────────────────────────────────────
  section('Account self-service');
  r = await mgr.req('PATCH', v1('/account'), { name: 'Max M. Manager' });
  check('update profile name', r.status === 200 && r.body.user.name === 'Max M. Manager', r.body);

  const mgrPhone = client();
  await mgrPhone.signIn(mgrEmail, 'Manager-pass-123');
  r = await mgr.req('GET', v1('/account/sessions'));
  check('sessions list (2, current flagged, no tokens)', r.body.length === 2 && r.body.filter((s) => s.current).length === 1 && !JSON.stringify(r.body).includes('token'), r.body);
  const phoneSession = r.body.find((s) => !s.current);
  r = await mgr.req('DELETE', v1(`/account/sessions/${phoneSession.id}`));
  check('revoke one session', r.status === 204, r.body);
  r = await mgrPhone.req('GET', v1('/me'));
  check('revoked session is rejected immediately', r.status === 401, r.status);
  r = await owner.req('DELETE', v1(`/account/sessions/${phoneSession.id}`));
  check("cannot revoke someone else's session (404)", r.status === 404, r.status);

  r = await mgr.req('POST', v1('/account/password'), { currentPassword: 'wrong-password-1', newPassword: 'Manager-pass-456' });
  check('wrong current password rejected', r.status === 400 || r.status === 401, r.body);
  await mgrPhone.signIn(mgrEmail, 'Manager-pass-123');
  r = await mgr.req('POST', v1('/account/password'), { currentPassword: 'Manager-pass-123', newPassword: 'Manager-pass-456' });
  check('change password', r.status === 200 && r.body.status === 'changed', r.body);
  r = await mgr.req('GET', v1('/me'));
  check('this device stays signed in (new cookie forwarded)', r.status === 200, r.status);
  r = await mgrPhone.req('GET', v1('/me'));
  check('other devices signed out', r.status === 401, r.status);
  r = await client().signIn(mgrEmail, 'Manager-pass-123');
  check('old password no longer works', r.status === 401, r.status);
  r = await client().signIn(mgrEmail, 'Manager-pass-456');
  check('new password works', r.status === 200, r.status);

  const newEmail = `max-${run}@servio.test`;
  r = await mgr.req('POST', v1('/account/email'), { newEmail });
  check('change email → confirmation to current address', r.status === 202, r.body);
  await sleep(200);
  const ce = await lastMail(mgrEmail, 'change-email');
  check('change-email confirmation mailed to the OLD address', ce?.text?.includes(newEmail), ce);

  section('PIN-only staff');
  r = await owner.req('POST', v1('/staff'), { name: 'Pita Waiter', role: 'waiter', pin: '4321' });
  const waiterId = r.body.userId;
  r = await owner.req('POST', v1('/devices'), { name: `Tablet ${run}` });
  const deviceToken = r.body.deviceToken;
  const waiter = client();
  r = await waiter.req('POST', '/api/auth/staff/pin-login', { deviceToken, userId: waiterId, pin: '4321' });
  waiter.bearer = r.body.token; waiter.cookie = '';
  r = await waiter.req('GET', v1('/account'));
  check('PIN staff see their account (no email exposed)', r.status === 200 && r.body.user.pinOnly && r.body.user.email === null, r.body);
  r = await waiter.req('POST', v1('/account/password'), { currentPassword: 'x'.repeat(10), newPassword: 'y'.repeat(12) });
  check('PIN staff cannot set a password (422 PIN_ONLY_ACCOUNT)', r.status === 422 && r.body.code === 'PIN_ONLY_ACCOUNT', r.body);
  r = await waiter.req('GET', v1('/invitations'));
  check('waiter cannot list invitations (403)', r.status === 403, r.status);

  section('Audit');
  r = await owner.req('GET', v1('/audit-logs?action=invitation.accept'));
  check('invitation acceptances audited in the restaurant', r.status === 200 && r.body.items.length >= 2, r.body);
  r = await owner.req('GET', v1('/audit-logs?action=restaurant.register'));
  check('self-service registration audited', r.body.items?.length === 1 && r.body.items[0].userId === ownerId, r.body);

  await redis.quit();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
}

main().catch(async (e) => { console.error(e); await redis.quit(); process.exit(1); });
