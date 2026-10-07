# Servio
## Restaurant Orders Management System: MVP Architecture (NestJS + Better Auth + Prisma)

**Status:** Draft v4
**Stack:** NestJS, TypeScript, Prisma, PostgreSQL, Better Auth, Redis, BullMQ, Socket.IO, React, Expo/React Native


### Changes from v3
- ORM changed from **TypeORM to Prisma**. One `schema.prisma` (multi-file) and one `prisma migrate` history now cover both domain and auth tables.
- Better Auth now uses its **official Prisma adapter** and shares the same Prisma schema. The "two pools, one database" setup and the read-only TypeORM entity workaround are gone.
- `TenantRepository` is replaced by a **tenant-scoped Prisma Client extension** (`withTenant`) that also sets the PostgreSQL RLS variable.
- Migrations: `prisma migrate dev --create-only` / `prisma migrate deploy`, with hand-written SQL for RLS policies.
- Money columns stay `Int` (minor units); `BigInt` handling notes updated for Prisma.

### Changes from v2 (carried forward)
- Auth framework changed from in-house Passport + JWT to **Better Auth** (organization, bearer, and Expo plugins, plus one custom staff-device/PIN plugin).
- `users` and `restaurants` identity live in Better Auth tables (`user`, `organization`, `member`, `session`...). Domain tables reference them.
- Rotating refresh tokens are replaced by Better Auth's DB-backed sessions (revocable instantly).

> **Verification note:** Both Better Auth and Prisma evolve quickly. Pin exact versions and check option names against the docs for the versions you install. In particular verify: `advanced.database.generateId`, plugin schema extensions, the Expo/Nest integration, the Better Auth CLI's Prisma output location, and the Prisma major-version differences (Prisma 7 uses `prisma.config.ts`, a generated client output path, and driver adapters such as `@prisma/adapter-pg`; the sketches below use that style).

---

## 1. Goals and Scope

### In scope (MVP)
- Menu and category management (items, modifiers, availability toggle)
- Order capture: dine-in and takeaway, via waiter/POS app
- Kitchen Display System (KDS) with live order and ticket status
- Bill generation and payment recording (cash, card, mobile money as manual entry)
- Basic daily sales reports
- Roles: Owner, Manager, Waiter, Kitchen, Cashier
- Single restaurant first, **multi-tenant-ready** (restaurant = Better Auth organization)

### Out of scope (post-MVP)
- Inventory and stock control
- Delivery dispatch and tracking
- Loyalty and promotions
- Customer-facing QR / online ordering
- Payment gateway integration
- Multi-branch consolidated reporting

### Non-functional targets
| Concern | Target |
|---|---|
| Order submit to KDS display | < 2 s on a normal connection |
| Availability | 99.5% during trading hours |
| Connectivity | Tolerate intermittent network (queued sync) |
| Data integrity | No duplicate orders or payments (idempotency) |
| Auditability | All voids, discounts, and price changes logged |

---

## 2. High-Level Architecture

```
 ┌────────────┐  ┌────────────┐  ┌──────────────┐
 │ Waiter/POS │  │  KDS (web) │  │ Admin (web)  │
 │ Expo/RN or │  │   React    │  │    React     │
 │ React PWA  │  │            │  │              │
 └─────┬──────┘  └─────┬──────┘  └──────┬───────┘
       │ better-auth   │ cookies/bearer │
       │ client + REST │ + REST + WS    │
       └───────────────┼────────────────┘
                       ▼
            ┌─────────────────────┐
            │  Nginx / ALB (TLS)  │
            └──────────┬──────────┘
                       ▼
 ┌───────────────────────────────────────────┐
 │  NestJS API (modular monolith)            │
 │  /api/auth/*   → Better Auth handler      │
 │  /api/v1/*     → domain controllers       │
 │  AuthGuard → session → tenant context     │
 │  Socket.IO gateway (real-time)            │
 └───┬─────────────────────────┬─────────────┘
     │ Prisma Client           │
     │ (tenant-scoped for      │
     │  domain; base client    │
     │  for Better Auth)       │
     ▼                         ▼
          PostgreSQL            Redis
   (domain tables + auth tables) (cache, BullMQ,
      one Prisma schema           WS adapter,
                                  auth sessions + rate limits)
```

### Key decisions
| Decision | Rationale |
|---|---|
| NestJS modular monolith | One deployable, enforced module boundaries via DI |
| TypeScript end to end | Shared types between API, admin, KDS, and mobile |
| **Prisma + PostgreSQL for all data** | Single schema file(s) for domain and auth tables, generated type-safe client, declarative migrations, transactions. Better Auth has an official Prisma adapter, so one ORM and one migration history cover everything |
| **Better Auth for identity** | Organizations (tenancy), roles/permissions, sessions, 2FA, social/SSO and passkeys available later without a rewrite |
| Custom Better Auth plugin for PIN + devices | No framework ships a device-bound PIN flow; a plugin keeps it inside the same session model |
| Socket.IO gateway | Rooms per restaurant/station, auto-reconnect, Redis adapter |
| Redis | BullMQ, cache, Socket.IO adapter, Better Auth `secondaryStorage` and rate limits |
| Integer money (minor units) | Avoids floating-point errors |
| Row-Level Security | Tenant isolation enforced in the DB, not only in code (applied through a Prisma Client extension, see §6) |

---

## 3. Modules

| Module | Responsibility |
|---|---|
| `auth` | Better Auth instance, plugins, access control, Nest guards, device/PIN plugin, manager approvals |
| `staff` | Staff directory (read models over `user`/`member`), staff admin endpoints that call Better Auth APIs |
| `catalog` | Categories, items, modifiers, pricing, availability |
| `floor` | Tables, sections, table status |
| `orders` | Order lifecycle, line items, notes, voids, state machine |
| `kitchen` | Ticket routing by station, KDS state |
| `billing` | Bills, tax (GST), discounts, split bills, payments |
| `reporting` | Daily sales, top items, staff performance |
| `settings` | Restaurant profile, tax config, printers, stations |
| `realtime` | Socket.IO gateway, room management |
| `audit` | Audit log writer and queries |

### Monorepo layout (pnpm workspaces + Turborepo)

```
apps/
  api/                          # NestJS
    prisma/
      schema/                   # Prisma multi-file schema
        base.prisma             # generator + datasource
        auth.prisma             # generated by Better Auth CLI (do not hand-edit)
        domain.prisma           # restaurants, orders, bills, ...
      migrations/               # single ordered history (incl. RLS SQL)
    prisma.config.ts
    src/
      main.ts                   # bodyParser: false (Better Auth parses its own routes)
      app.module.ts
      config/
      common/
        decorators/             # @CurrentSession, @RequirePermission, @Public
        guards/                 # SessionGuard, PermissionGuard, ManagerApprovalGuard
        interceptors/           # IdempotencyInterceptor, AuditInterceptor
        filters/
        tenancy/                # TenantContext (AsyncLocalStorage), withTenant helper
        money/
      database/
        prisma.service.ts       # base PrismaClient (lifecycle, adapter)
        tenant-prisma.ts        # tenant-scoped client extension (RLS + restaurantId)
        auth-guard.extension.ts # blocks direct writes to Better Auth models
      modules/
        auth/
          auth.config.ts        # betterAuth({...}) with prismaAdapter
          access-control.ts     # statements + roles
          plugins/
            staff-device.plugin.ts
          auth.module.ts        # mounts handler at /api/auth/*
        staff/ catalog/ floor/ orders/ kitchen/
        billing/ reporting/ settings/ realtime/ audit/
      jobs/                     # BullMQ processors
  admin/                        # React (Vite)
  kds/                          # React (Vite), full-screen
  waiter/                       # Expo (React Native) or React PWA
packages/
  shared-types/                 # enums, DTOs, event payloads, access-control statements
  api-client/                   # generated from OpenAPI (domain API only)
```

### Module conventions
- Controllers stay thin; business rules live in services or use-case classes (`SendOrderUseCase`).
- Modules interact through exported services and domain events.
- DTOs use `class-validator` with a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- **Auth tables are written only through Better Auth.** Prisma models for `user`, `member`, and `organization` exist (generated), but application code only reads them (joins, reporting). A client extension rejects `create/update/delete/upsert` on those models outside the `auth` module.
- Services never import the base `PrismaClient` directly; they receive a tenant-scoped client (see §6).

---

## 4. Authentication and Authorization (Better Auth)

### 4.1 Integration approach
- Better Auth runs **inside the NestJS process**, mounted at `/api/auth/*` (Better Auth's default base path, so its client SDKs work without extra config).
- Two ways to mount: the community `@thallesp/nestjs-better-auth` package, or a thin handler of your own using `toNodeHandler(auth)` plus a small `SessionGuard` calling `auth.api.getSession({ headers })`. Prefer the thin handler if you want zero dependency on a community wrapper; both need `bodyParser: false` on the Nest app (and re-enabling JSON parsing for non-auth routes if you hand-roll it).
- Better Auth connects through its **official Prisma adapter** (`prismaAdapter(prisma, { provider: 'postgresql' })`). It receives its own **base** `PrismaClient` instance (no tenant extension, because auth tables are not RLS-scoped). Domain code uses a separate tenant-scoped client. Both point at the same database and the same Prisma schema.

### 4.2 Better Auth configuration (sketch)

```ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

export const auth = betterAuth({
  database: prismaAdapter(authPrisma, { provider: 'postgresql' }), // authPrisma = base PrismaClient
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.ADMIN_ORIGIN!, process.env.KDS_ORIGIN!, 'waiterapp://'],

  emailAndPassword: {
    enabled: true,
    // Optional: swap scrypt for argon2 via password.hash / password.verify
    sendResetPassword: async ({ user, url }) => mailer.sendReset(user.email, url),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // owners/managers (sliding)
    updateAge: 60 * 30,
    // staff sessions get a shorter expiry set inside the PIN endpoint
  },

  advanced: {
    database: { generateId: 'uuid' }, // pair with @db.Uuid in the Prisma schema, see 4.8
  },

  secondaryStorage: redisSecondaryStorage,   // sessions + rate-limit counters in Redis

  rateLimit: {
    enabled: true,
    storage: 'secondary-storage',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/staff/pin-login': { window: 60, max: 5 },
      '/staff/manager-approval': { window: 60, max: 5 },
    },
  },

  plugins: [
    organization({
      ac, roles,                        // see 4.4
      creatorRole: 'owner',
      allowUserToCreateOrganization: false, // restaurants are provisioned by onboarding, not by staff
    }),
    bearer(),          // Authorization: Bearer for non-cookie clients
    expo(),            // @better-auth/expo for the React Native app
    staffDevice(),     // custom plugin, see 4.5
    // twoFactor(), passkey()  → post-MVP for Owner/Manager
  ],
});
```

### 4.3 Identity model
| Concept | Better Auth construct |
|---|---|
| Restaurant (tenant) | `organization` (its `id` is the `restaurant_id` used everywhere) |
| Staff membership and role | `member` (`owner`, `manager`, `waiter`, `kitchen`, `cashier`) |
| Current tenant in a request | `session.activeOrganizationId` |
| Owner/Manager login | Email + password (`emailAndPassword`) |
| Floor staff | `user` rows with a placeholder email (e.g. `<uuid>@staff.invalid`), **no credential account**, so password sign-in is impossible; they authenticate only through the PIN endpoint |
| Multi-branch (later) | A user is a member of several organizations; `setActiveOrganization` switches context |

### 4.4 Roles and permissions (organization access control)

```ts
import { createAccessControl } from 'better-auth/plugins/access';

export const statement = {
  menu:    ['read', 'manage'],
  order:   ['create', 'update', 'void'],
  ticket:  ['read', 'update'],
  bill:    ['create', 'pay', 'discount'],
  report:  ['read'],
  staff:   ['manage'],
  settings:['manage'],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  owner:   ac.newRole({ menu: ['read','manage'], order: ['create','update','void'], ticket: ['read','update'],
                        bill: ['create','pay','discount'], report: ['read'], staff: ['manage'], settings: ['manage'] }),
  manager: ac.newRole({ menu: ['read','manage'], order: ['create','update','void'], ticket: ['read','update'],
                        bill: ['create','pay','discount'], report: ['read'] }),
  waiter:  ac.newRole({ menu: ['read'], order: ['create','update'], ticket: ['read'], bill: ['create'] }),
  kitchen: ac.newRole({ menu: ['read'], ticket: ['read','update'] }),
  cashier: ac.newRole({ menu: ['read'], order: ['update'], bill: ['create','pay'] }),
};
```

- Statements live in `packages/shared-types` so the clients can hide UI the user cannot use. **The server is still the only enforcement point.**
- Controllers declare `@RequirePermission('order', 'void')`; `PermissionGuard` calls `auth.api.hasPermission({ headers, body: { permissions } })`.

### 4.5 Floor staff: device registration + PIN (custom plugin)

Better Auth does not ship a device-bound PIN flow, so `staffDevice()` adds it while keeping everything inside the normal session model.

**Schema additions (via plugin `schema`, emitted into `auth.prisma` by the Better Auth CLI):**
- `device`: `id, organization_id, name, token_hash, approved_by, approved_at, last_seen_at, revoked_at`
- `staff_pin`: `user_id, organization_id, pin_hash, failed_attempts, locked_until, updated_at`
- `manager_approval`: `id, organization_id, approver_id, action, subject_id, expires_at, consumed_at`
- Session additional field: `device_id`

**Endpoints:**
```
POST /api/auth/staff/devices                 # manager: register device → returns one-time device token
POST /api/auth/staff/devices/:id/revoke      # manager: revoke device + its sessions
GET  /api/auth/staff/roster                  # device token: list staff tiles for this restaurant
POST /api/auth/staff/pin-login               # device token + userId + PIN → session
POST /api/auth/staff/set-pin                 # manager sets/resets a staff PIN
POST /api/auth/staff/manager-approval        # manager PIN + action + subject → short-lived approval token
```

**`pin-login` flow:**
1. Resolve the device from the device token (hash lookup); reject if revoked. The device fixes the organization.
2. Check lockout for this `(device, user)` and `user` (`locked_until`).
3. Verify PIN: `hash(HMAC(PIN, PIN_PEPPER))`. The pepper is a server secret, so a leaked DB cannot be brute-forced offline across the tiny 4 to 6 digit PIN space.
4. On failure: increment `failed_attempts`, lock after N attempts, return a generic error.
5. On success: reset counters, create a session through Better Auth's internal adapter with `activeOrganizationId` and `device_id` set, a shorter expiry (shift length, e.g. 12 h), and set the session cookie or return the bearer token.

```ts
export const staffDevice = () => ({
  id: 'staff-device',
  schema: { /* device, staffPin, managerApproval, session.deviceId */ },
  endpoints: {
    pinLogin: createAuthEndpoint('/staff/pin-login',
      { method: 'POST', body: z.object({ deviceToken: z.string(), userId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) }) },
      async (ctx) => {
        // 1 resolve device  2 lockout check  3 verify peppered PIN hash
        // 4 on failure: bump counter, maybe lock  5 on success: createSession + set cookie/bearer
      }),
    // roster, registerDevice, revokeDevice, setPin, managerApproval ...
  },
});
```

Inside plugin endpoints, use Better Auth's `ctx.context.adapter` (which runs through the Prisma adapter) rather than importing the app's Prisma client, so plugin logic stays portable and transactional behaviour is consistent with the rest of Better Auth.

### 4.6 Step-up auth (void, discount, price override)
- Role permission is necessary but not sufficient. These actions also require a **manager approval token**.
- Flow: manager enters their PIN on the waiter's device → `POST /staff/manager-approval` with `{ action, subjectId }` → returns an opaque token valid ~60 s, single use, bound to `(organization, action, subject)`.
- `ManagerApprovalGuard` reads `X-Approval-Token`, verifies it, and marks it consumed **in the same Prisma transaction** as the action (`prisma.$transaction`). The action is written to `audit_logs` with both the acting user and the approver.

### 4.7 Sessions, tokens, and clients
| Client | Transport | Notes |
|---|---|---|
| Admin (web) | Secure, httpOnly session cookie | `credentials: 'include'`, CORS with explicit origins |
| KDS (web) | Session cookie (or bearer via device PIN login) | Long-running tab; handle 401 by returning to PIN screen |
| Waiter (Expo) | `@better-auth/expo` with SecureStore | Bearer token on API calls and the socket handshake |
| Socket.IO | Cookie or `auth.token` in handshake | Server validates with `auth.api.getSession({ headers })` |

- Sessions are **DB-backed opaque tokens**, revocable immediately (`revokeSession`, `revokeSessions`, or deleting by `device_id`). No JWT or refresh-rotation logic to maintain.
- Sessions and rate-limit counters sit in Redis via `secondaryStorage`, reducing Postgres load on every request.
- Avoid long `cookieCache` windows for roles with destructive permissions, or revocation lag will exceed the cache lifetime.
- Optional later: Better Auth `jwt` plugin if another service ever needs to verify tokens without calling the API.

### 4.8 Better Auth and Prisma together
1. **One schema, split by ownership.** Use Prisma's multi-file schema (`prisma/schema/`). `auth.prisma` is generated by `npx @better-auth/cli generate` and is never hand-edited; `domain.prisma` holds everything else. Keeping them in separate files means regenerating auth models cannot clobber domain models or your manual tweaks.
2. **ID type:** set `advanced.database.generateId: 'uuid'` and make the id columns `String @id @db.Uuid` (apply this in a small post-generate step or script so regeneration is repeatable). Domain foreign keys to `user`/`organization` use `String @db.Uuid` as well, so joins and FKs line up. If you would rather keep Better Auth's default `text` ids, make domain FK columns plain `String` instead. Decide this in Phase 1 and stick to it.
3. **One migration pipeline:** after any auth config or plugin change, run the CLI `generate`, then `prisma migrate dev --create-only`, review the SQL, and commit. CI applies one ordered history with `prisma migrate deploy` on a clean DB. No separate auth migration step.
4. **Plugin tables** (`device`, `staff_pin`, `manager_approval`) and the `session.device_id` field come out of the same generate step.
5. **Foreign keys:** domain models relate to `User` and `Organization`. `Restaurant` shares its primary key with `organization.id` (created in an organization `afterCreate` hook) and holds currency, tax rate, timezone, settings.
6. **RLS:** domain tables have policies on `restaurant_id`, added as hand-written SQL inside migrations (Prisma's schema language cannot express RLS). Better Auth tables are not RLS-protected (the library needs unscoped access). Use two `PrismaClient` instances: the Better Auth one on the base client, the domain one wrapped by the tenant extension. For stronger isolation, give each instance its own DB role and connection string with only the privileges it needs.
7. **Guard rails on auth models:** a client extension on the domain/base client throws on writes to Better Auth models (`user`, `session`, `account`, `member`, `organization`, `invitation`, `verification`, `device`, `staff_pin`, `manager_approval`) unless the call comes from the auth module.

---

## 5. Data Model

```
organization (= restaurant) ─┬─< member >─ user
                             ├─< device, staff_pin, manager_approval
restaurants (shared PK) ─────┤
                             ├─< stations
                             ├─< tables
                             ├─< categories ─< menu_items ─< modifier_groups ─< modifiers
                             ├─< orders ─< order_items ─< order_item_modifiers
                             │      │            └── kitchen_tickets (station, status)
                             │      └─< bills ─< payments
                             ├─< idempotency_keys
                             └─< audit_logs
```

### Better Auth–managed tables (do not write via Prisma directly)
`user, session, account, verification, organization, member, invitation` + plugin tables `device, staff_pin, manager_approval`. These live in `auth.prisma` and are generated.

### Domain tables (Prisma models in `domain.prisma`)

**restaurants**
`id (= organization.id), currency, tax_rate_bps, timezone, settings (Json), created_at`

**tables**
`id, restaurant_id, label, section, seats, status (free|occupied|reserved)`

**stations**
`id, restaurant_id, name (grill, bar, fry, cold), printer_id nullable`

**categories**
`id, restaurant_id, name, sort_order, active`

**menu_items**
`id, restaurant_id, category_id, station_id, name, description, price_minor, available, image_path, sort_order`

**modifier_groups / modifiers**
`group: id, menu_item_id, name, min_select, max_select`
`modifier: id, group_id, name, price_delta_minor`

**orders**
`id, restaurant_id, table_id nullable, type (dine_in|takeaway), status, waiter_id → user.id, customer_note, subtotal_minor, tax_minor, discount_minor, total_minor, opened_at, closed_at`

**order_items**
`id, order_id, menu_item_id, name_snapshot, unit_price_minor (snapshot), qty, notes, status, voided_at, voided_by → user.id`

**order_item_modifiers**
`id, order_item_id, name_snapshot, price_delta_minor`

**kitchen_tickets**
`id, restaurant_id, order_id, station_id, status (new|preparing|ready|served), fired_at, ready_at`

**bills**
`id, restaurant_id, order_id, number, subtotal_minor, tax_minor, discount_minor, total_minor, status (open|paid|void)`

**payments**
`id, restaurant_id, bill_id, method (cash|card|mobile_money|other), amount_minor, reference, received_by → user.id, paid_at`

**idempotency_keys**
`id, restaurant_id, key, scope, request_hash, response_status, response_body (Json), created_at`, unique `(restaurant_id, key, scope)`

**audit_logs**
`id, restaurant_id, user_id, approver_id nullable, device_id nullable, action, subject_type, subject_id, before (Json), after (Json), created_at`

### Data rules
- Snapshot name and price on order items; menu edits never rewrite history.
- Soft-void items and orders; never hard-delete financial records.
- Money columns are `Int` (minor units). If `BigInt` is ever needed, remember Prisma returns JavaScript `bigint`, which `JSON.stringify` cannot serialize; add a serializer or convert at the DTO boundary.
- UUID primary keys (`@default(uuid()) @db.Uuid`), so clients can also generate IDs offline.
- Indexes (declared with `@@index`): `orders (restaurant_id, status, opened_at)`, `kitchen_tickets (station_id, status)`, `order_items (order_id)`.
- Map names to snake_case tables/columns with `@@map` / `@map`, keeping camelCase in the TypeScript client.
- Schema changes only through `prisma migrate`; never `prisma db push` outside a throwaway local DB.

### Example model

```prisma
enum OrderStatus {
  OPEN
  SENT_TO_KITCHEN
  PREPARING
  READY
  SERVED
  BILLED
  PAID
  CANCELLED
  VOIDED
}

enum OrderType {
  dine_in
  takeaway
}

model Order {
  id             String      @id @default(uuid()) @db.Uuid
  restaurantId   String      @map("restaurant_id") @db.Uuid
  status         OrderStatus @default(OPEN)
  type           OrderType
  tableId        String?     @map("table_id") @db.Uuid
  waiterId       String      @map("waiter_id") @db.Uuid     // → "user".id (Better Auth)

  subtotalMinor  Int         @default(0) @map("subtotal_minor")
  taxMinor       Int         @default(0) @map("tax_minor")
  discountMinor  Int         @default(0) @map("discount_minor")
  totalMinor     Int         @default(0) @map("total_minor")

  openedAt       DateTime    @default(now()) @map("opened_at") @db.Timestamptz
  closedAt       DateTime?   @map("closed_at") @db.Timestamptz

  restaurant     Restaurant  @relation(fields: [restaurantId], references: [id])
  waiter         User        @relation(fields: [waiterId], references: [id])
  items          OrderItem[]

  @@index([restaurantId, status, openedAt])
  @@map("orders")
}
```

---

## 6. Multi-Tenancy

1. **Tenant source of truth:** `session.activeOrganizationId` from Better Auth. `SessionGuard` resolves the session, then populates `TenantContext` (`AsyncLocalStorage` via `nestjs-cls`) with `{ userId, restaurantId, role, deviceId }`.
2. **Scoped data access:** services get their client from `TenantPrismaService`, which returns the base `PrismaClient` wrapped in a **client extension** that (a) injects `restaurantId` into `where` on reads/updates/deletes and into `data` on creates for tenant-owned models, and (b) sets the RLS variable. Importing the base client outside `database/` and `auth/` is blocked by a lint rule.
3. **PostgreSQL RLS (defence in depth):** every unit of work runs inside a transaction that first sets the tenant variable. Prisma has no native RLS support, so wrap this in one helper:

```ts
// database/tenant-prisma.ts
export function withTenant<T>(
  prisma: PrismaClient,
  restaurantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_restaurant', ${restaurantId}, TRUE)`;
    return fn(tx); // set_config(..., TRUE) is local to this transaction, like SET LOCAL
  });
}
```

   - Business operations (send order, take payment, void) use `withTenant(...)` so all statements and the audit write share one transaction and one RLS context.
   - For simple single-query reads, a `$allOperations` query extension can wrap each call in a batch `$transaction([set_config, query])` (the pattern from Prisma's RLS example). It costs an extra round trip per query, so prefer `withTenant` on hot paths.
   - Always use `set_config(..., TRUE)` (transaction-local). Session-level settings can leak between requests on pooled connections.

   Policies are plain SQL in a migration (create it with `prisma migrate dev --create-only`, then edit):

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (restaurant_id = current_setting('app.current_restaurant')::uuid);
```

   The app's runtime connection uses a **non-superuser role that does not own the tables** (owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set). Run migrations with a separate owner role, and give the app role only DML rights.
4. **Tests:** cross-tenant access attempts (API, socket rooms, RLS) must fail closed. Include a test that queries with a missing/empty tenant variable and gets an error or zero rows.

---

## 7. Order State Machine

```
OPEN → SENT_TO_KITCHEN → PREPARING → READY → SERVED → BILLED → PAID
  └──────────────→ CANCELLED / VOIDED (manager approval token)
```

| Transition | Trigger | Permission |
|---|---|---|
| OPEN → SENT_TO_KITCHEN | Send order | `order:create/update` |
| SENT_TO_KITCHEN → PREPARING | First ticket started | `ticket:update` |
| PREPARING → READY | All tickets ready | `ticket:update` |
| READY → SERVED | Delivered to table | `order:update` |
| SERVED → BILLED | Bill generated | `bill:create` |
| BILLED → PAID | Payments cover total | `bill:pay` |
| any → VOIDED | Void with reason | `order:void` + manager approval |

```ts
import { OrderStatus } from '@prisma/client'; // or the generated client path (Prisma 7)

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  OPEN: ['SENT_TO_KITCHEN', 'CANCELLED'],
  SENT_TO_KITCHEN: ['PREPARING', 'VOIDED'],
  PREPARING: ['READY', 'VOIDED'],
  READY: ['SERVED', 'VOIDED'],
  SERVED: ['BILLED', 'VOIDED'],
  BILLED: ['PAID', 'VOIDED'],
  PAID: [], CANCELLED: [], VOIDED: [],
};

@Injectable()
export class OrderStateMachine {
  assertCan(from: OrderStatus, to: OrderStatus) {
    if (!TRANSITIONS[from].includes(to)) {
      throw new UnprocessableEntityException(`Invalid transition ${from} -> ${to}`);
    }
  }
}
```

- Item and ticket statuses roll up to the order status.
- Every transition runs inside a `withTenant` transaction and emits a domain event after commit. Guard against races with a conditional update, e.g. `updateMany({ where: { id, status: from }, data: { status: to } })` and checking `count === 1`.

---

## 8. Real-Time Flow

1. Waiter submits order: `POST /api/v1/orders/:id/send`
2. API runs one transaction: validate state, create one ticket per station, update order status.
3. After commit, emit `kitchen.ticket.created` via `@nestjs/event-emitter`; a `realtime` listener broadcasts to Socket.IO rooms.
4. KDS receives and renders the ticket.
5. Kitchen taps *Preparing* / *Ready*: `PATCH /api/v1/kitchen-tickets/:id`.
6. `ticket.ready` is broadcast to the waiters room; the waiter device notifies.

### Rooms
| Room | Events |
|---|---|
| `r:{restaurantId}:station:{stationId}` | `ticket.created`, `ticket.updated` |
| `r:{restaurantId}:waiters` | `ticket.ready`, `table.status.changed` |
| `r:{restaurantId}:admin` | `order.closed`, `void.requested` |

### Gateway sketch (Better Auth session on handshake)

```ts
@WebSocketGateway({ namespace: '/rt', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  async handleConnection(socket: Socket) {
    const headers = new Headers();
    if (socket.handshake.headers.cookie) headers.set('cookie', socket.handshake.headers.cookie);
    if (socket.handshake.auth?.token) headers.set('authorization', `Bearer ${socket.handshake.auth.token}`);

    const session = await auth.api.getSession({ headers });
    if (!session?.session.activeOrganizationId) return socket.disconnect(true);

    const rid = session.session.activeOrganizationId;
    socket.data = { userId: session.user.id, restaurantId: rid };
    socket.join(`r:${rid}:all`);
    // role-specific and station rooms are joined on request, validated against the member's role
  }

  @OnEvent('kitchen.ticket.created')
  onTicketCreated(e: TicketCreatedEvent) {
    this.server.to(`r:${e.restaurantId}:station:${e.stationId}`).emit('ticket.created', e.payload);
  }
}
```

### Resilience
- Emit events only **after** the transaction commits (publish after `withTenant` resolves, not inside the callback).
- Socket.IO Redis adapter allows multiple API instances.
- On session revocation (device or user), disconnect that user's sockets (`server.in(userRoom).disconnectSockets()`).
- KDS falls back to polling every 10 s if the socket drops and refetches active tickets on reconnect. The API is the source of truth.

---

## 9. API Design

Domain API: REST, JSON, `/api/v1`, OpenAPI via `@nestjs/swagger`. Auth API: Better Auth, `/api/auth/*`.

### Auth (Better Auth + custom plugin)
```
POST   /api/auth/sign-in/email            # Owner/Manager
POST   /api/auth/sign-out
GET    /api/auth/get-session
POST   /api/auth/organization/set-active  # multi-branch, later
POST   /api/auth/staff/pin-login          # device token + user + PIN
GET    /api/auth/staff/roster
POST   /api/auth/staff/devices            # register / approve device
POST   /api/auth/staff/devices/:id/revoke
POST   /api/auth/staff/set-pin
POST   /api/auth/staff/manager-approval
```

### Domain
```
GET    /api/v1/me                          # session + role + permissions for client gating

GET    /api/v1/menu                        # cached, ETag
POST   /api/v1/categories
POST   /api/v1/menu-items
PATCH  /api/v1/menu-items/:id
PATCH  /api/v1/menu-items/:id/availability

GET    /api/v1/tables
PATCH  /api/v1/tables/:id

POST   /api/v1/orders                      # Idempotency-Key
GET    /api/v1/orders?status=open
GET    /api/v1/orders/:id
POST   /api/v1/orders/:id/items
PATCH  /api/v1/orders/:id/items/:itemId
DELETE /api/v1/orders/:id/items/:itemId    # before send; otherwise void
POST   /api/v1/orders/:id/send
POST   /api/v1/orders/:id/void             # X-Approval-Token

GET    /api/v1/kitchen-tickets?station=&status=
PATCH  /api/v1/kitchen-tickets/:id

POST   /api/v1/orders/:id/bill
POST   /api/v1/bills/:id/payments          # Idempotency-Key
POST   /api/v1/bills/:id/discount          # X-Approval-Token

GET    /api/v1/reports/daily?date=
GET    /api/v1/reports/top-items?from=&to=
```

### Conventions
- Error envelope via global filter: `{ "message", "code", "errors": {} }`. The filter also maps Prisma errors (e.g. `P2002` unique violation → 409, `P2025` record not found → 404) so they never leak raw.
- Cursor pagination on list endpoints (Prisma's `cursor` / `take` / `skip: 1`).
- `Idempotency-Key` required on order creation and payments, enforced by `IdempotencyInterceptor` (same key + same hash returns the stored response; same key + different hash returns 409). The unique `(restaurant_id, key, scope)` constraint is the final guard against races.
- Rate limiting: Better Auth's limiter on `/api/auth/*`; `@nestjs/throttler` (Redis storage) on `/api/v1/*`.

---

## 10. Client Applications

| App | Tech | Users | Key screens |
|---|---|---|---|
| Waiter/POS | Expo (React Native) or React PWA | Waiter, Cashier | Device setup, staff tiles + PIN, table map, menu, cart, send, bill, pay |
| KDS | React (Vite), full-screen | Kitchen | Device setup, PIN, station board, ticket cards, timers, bump |
| Admin | React (Vite) + TanStack Query | Owner, Manager | Login, menu, tables, staff/devices/PINs, reports, settings |

Auth clients:
- Web: `createAuthClient` from `better-auth/react` with `organizationClient()` and a small custom client plugin for the `/staff/*` endpoints.
- Expo: `@better-auth/expo` client with SecureStore for session storage.
- Domain API client generated from OpenAPI; `packages/shared-types` carries enums, event payloads, and the access-control statements. Clients never import the Prisma client; shared enums are re-declared (or generated) in `shared-types`.

---

## 11. Offline Tolerance

- Waiter app caches menu and tables locally (ETag refresh).
- Orders created offline are queued locally with a client-generated UUID and `Idempotency-Key`.
- The device token persists in secure storage, so a restart does not require re-registration.
- Staff sessions last a shift. If the session expires while offline, the queue is preserved; after PIN re-login the sync worker replays it (idempotency keys make replays safe). Void/discount approvals cannot be performed offline.
- UI shows sync state (queued, syncing, synced, failed).
- Post-MVP: on-premise node on the restaurant LAN syncing to the cloud (would need its own auth story).

---

## 12. Security

- Better Auth sessions: secure, httpOnly, SameSite cookies on web; SecureStore + bearer on mobile.
- Passwords: Better Auth default scrypt, or argon2 via `password.hash/verify` override.
- PINs: peppered hash, lockout per user and per device, rate-limited endpoint, generic error messages.
- Device tokens: high-entropy, stored hashed, revocable; revoking a device deletes its sessions and disconnects its sockets.
- Step-up: single-use, short-lived manager approval tokens bound to action and subject.
- Authorization: organization access control via `PermissionGuard`; server-side only.
- Tenant isolation: tenant context + tenant-scoped Prisma extension + RLS; separate DB roles for the Better Auth client, the app runtime, and migrations.
- Raw SQL (`$queryRaw`, `$executeRaw`) is allowed only as tagged templates (parameterised); `$queryRawUnsafe` / `$executeRawUnsafe` are banned by lint.
- Audit log for sensitive actions (actor, approver, device, before/after).
- `helmet`, strict CORS (explicit origins, credentials), TLS everywhere, secrets from env or a secret manager (`BETTER_AUTH_SECRET`, `PIN_PEPPER`).
- Never trust client totals; the server recomputes money.
- Email verification and password reset need a mail provider (e.g. SES) for Owner/Manager accounts.

### Permission matrix
| Action | Owner | Manager | Waiter | Kitchen | Cashier |
|---|:-:|:-:|:-:|:-:|:-:|
| Manage menu | ✓ | ✓ | | | |
| Create/edit order | ✓ | ✓ | ✓ | | |
| Update kitchen ticket | ✓ | ✓ | | ✓ | |
| Void / discount | ✓ | ✓ | | | |
| Take payment | ✓ | ✓ | | | ✓ |
| View reports | ✓ | ✓ | | | |
| Manage staff/devices/settings | ✓ | | | | |

Void and discount additionally require a manager approval token.

---

## 13. Background Jobs (BullMQ)

| Queue | Jobs |
|---|---|
| `reports` | Nightly daily-sales rollup, on-demand recompute |
| `print` | Receipt and kitchen ticket printing (post-MVP) |
| `notifications` | Push notifications to waiter devices |
| `maintenance` | Idempotency key cleanup, expired approvals/sessions cleanup, stale device report |

- Processors ship in the same codebase as a separate `worker` container (`main.worker.js`), using the same Prisma client setup. Jobs carry `restaurantId` and run through `withTenant`, so RLS applies to background work too.
- Scheduled work via `@nestjs/schedule` (single instance) enqueues BullMQ jobs.

---

## 14. Infrastructure and DevOps

| Concern | MVP choice |
|---|---|
| Hosting | Single AWS EC2/Lightsail host, Docker Compose |
| Services | `api` (includes Better Auth), `worker`, `nginx`, `redis`, `postgres`, one-shot `migrate` |
| DB | PostgreSQL in container, move to RDS once stable |
| Files | S3 for menu images |
| CI/CD | GitHub Actions: lint, `prisma validate`, test, build image (`prisma generate`), deploy |
| Monitoring | Sentry, `@nestjs/terminus` health checks, uptime checks |
| Backups | Daily `pg_dump`/snapshot, 7-day retention, restore tested |
| Environments | local, staging, production |

### Docker Compose (outline)

```yaml
services:
  nginx:
    image: nginx:stable
    depends_on: [api]
    ports: ["80:80", "443:443"]
  migrate:
    build: ./apps/api
    command: npx prisma migrate deploy
    env_file: .env        # MIGRATION_DATABASE_URL (owner role)
    depends_on: [postgres]
  api:
    build: ./apps/api
    command: node dist/main.js
    env_file: .env        # DATABASE_URL (app role), BETTER_AUTH_SECRET, BETTER_AUTH_URL, PIN_PEPPER, REDIS_URL
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_started }
  worker:
    build: ./apps/api
    command: node dist/main.worker.js
    env_file: .env
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_started }
  postgres:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
volumes:
  pgdata:
```

Nginx must pass WebSocket upgrades to `/socket.io/` and forward cookies/`Authorization` unchanged. Set `BETTER_AUTH_URL` to the public HTTPS origin. Run `prisma generate` at image build time, and make sure the image includes whatever engine/adapter files your Prisma version needs at runtime.

### Migrations workflow
```
# 1. Regenerate Better Auth models after plugin/config changes (writes auth.prisma), review the diff
npx @better-auth/cli generate
# 2. Edit domain.prisma as needed, then create ONE migration for all schema changes (review the SQL,
#    add RLS policies / custom SQL by hand)
pnpm --filter api prisma migrate dev --create-only --name <name>
pnpm --filter api prisma migrate dev          # applies locally
# 3. Staging/production (CI/deploy step, uses the owner role)
pnpm --filter api prisma migrate deploy
```
Migrations run as a deploy step before the new `api` starts. Never edit an applied migration; add a new one. Review every generated migration by hand (Prisma can generate destructive SQL for renames, so use `@map` or hand-edit renames).

---

## 15. Observability

- Structured JSON logs with `nestjs-pino`: `restaurantId`, `userId`, `deviceId`, `orderId`, request ID.
- Prisma query events (`log: [{ emit: 'event', level: 'query' }]`) feed slow-query logging in non-production and a slow-query threshold alert in production.
- Auth metrics: PIN failures, lockouts, approval-token usage, device revocations, session count per restaurant.
- Operational metrics: order-to-ticket latency, ticket-to-ready time, failed syncs, queue depth, socket connections, Prisma connection pool usage.
- Alerts: PIN-failure spikes, queue backlog, failed jobs, 5xx rate, DB disk usage.

---

## 16. Testing Strategy

| Layer | Approach |
|---|---|
| Unit | State machine, money/tax calc, PIN hashing/lockout logic, approval-token binding |
| Integration | Services against real PostgreSQL via Testcontainers, schema applied with `prisma migrate deploy` (so RLS policies are actually under test), including Better Auth tables |
| E2E (API) | Supertest per role, permission matrix, session expiry/revocation |
| Auth | Revoked device cannot log in; revoked session is rejected immediately; approval token is single-use and action-bound; lockout after N PIN failures |
| Tenancy | Cross-tenant access attempts fail (API, socket rooms, RLS); missing tenant variable fails closed; writes to auth models outside the auth module are rejected |
| Real-time | Socket.IO client e2e asserting event delivery and disconnect on revoke |
| Idempotency | Replay same request, assert a single record |
| Smoke | Order → kitchen → ready → bill → pay |

Avoid mocking Prisma in integration tests; RLS and constraints are part of the behaviour being verified.

---

## 17. Reporting (MVP)

- Daily sales total, order count, average order value
- Payments by method
- Top 10 items by quantity and revenue
- Voids and discounts summary (with approver)
- Staff performance (orders and sales per waiter via `User`/`Member` relations)
- Prisma `groupBy` / `aggregate` for simple rollups; `$queryRaw` (tagged template) or TypedSQL for heavier aggregates. Results cached per day in Redis, recalculated by the nightly job and on demand.

---

## 18. Build Plan

| Phase | Deliverable | Rough effort |
|---|---|---|
| 1 | Monorepo scaffold, config, **Prisma schema + Better Auth (Prisma adapter) + organization + access control**, single migration pipeline, tenancy extension + RLS, CI | 1.5 weeks |
| 2 | **Staff-device plugin** (devices, PIN login, lockout, approvals) + admin staff/device UI | 1.5 weeks |
| 3 | Catalog and tables (API + admin UI) | 1 week |
| 4 | Orders, state machine, idempotency, waiter app basics | 2 weeks |
| 5 | Kitchen tickets, KDS, Socket.IO real-time with session handshake | 1.5 weeks |
| 6 | Billing, payments, discounts, audit | 1.5 weeks |
| 7 | Reports and BullMQ jobs | 1 week |
| 8 | Offline sync, hardening, pilot deployment | 2 weeks |

Estimates assume a small team (1 to 2 backend, 1 to 2 frontend/mobile).

---

## 19. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Prisma has no native RLS support | Wrap all tenant work in `withTenant` (transaction-local `set_config`); RLS policies in reviewed SQL migrations; tenancy tests run against real Postgres |
| Better Auth CLI regenerates `auth.prisma` and may overwrite manual edits (e.g. `@db.Uuid`) | Keep auth models in their own file, apply tweaks via a repeatable post-generate script, review the diff on every regeneration |
| Better Auth API churn | Pin exact versions, wrap behind `auth` module services, upgrade deliberately with the auth e2e suite |
| Prisma major-version changes (config file, client output, driver adapters) | Pin versions, upgrade deliberately, keep the Prisma setup isolated in `database/` |
| Custom PIN/device plugin is security-critical | Keep it small, peppered hashes, lockouts, thorough tests, security review before pilot |
| Community NestJS wrapper maintenance | Use a thin in-repo handler and guard as the fallback |
| ID type mismatch (text vs uuid) | Decide in Phase 1, script the `@db.Uuid` adjustment, verify with a migration on a clean DB |
| Session lookup on every request | Redis `secondaryStorage`; measure; short cache only where revocation lag is acceptable |
| Unreliable connectivity | Offline queue, polling fallback, idempotency, device token persists |
| Duplicate orders/payments | Idempotency interceptor + unique constraints |
| Prisma pitfalls (N+1 from loops, interactive transaction timeouts, `BigInt` serialization, pool exhaustion) | Use `include`/`select` or `relationLoadStrategy: 'join'`, keep transactions short, integer money, size the pool per instance (api + worker) and monitor it |
| Tenant data leakage | Tenant extension + RLS + automated tests |
| Scope creep | Hold the MVP scope in §1 |

---

## 20. Future Roadmap

1. Owner/Manager 2FA (TOTP) and passkeys via Better Auth plugins
2. Google/Microsoft sign-in or SSO for admins (Better Auth social/SSO), no separate IdP needed
3. Multi-branch: one user across several organizations, branch switcher
4. Thermal receipt and kitchen printing (ESC/POS)
5. Inventory and recipe costing
6. QR table ordering for customers
7. Mobile money / card gateway integration
8. On-premise offline-first node

---

## 21. Open Questions

- Floor-staff identity: placeholder emails (`@staff.invalid`) vs the `username` plugin?
- Staff session length (shift-length vs fixed hours) and whether KDS devices get a longer-lived session?
- Cookie vs bearer for KDS and the PWA waiter option (cross-site cookie constraints)?
- Mail provider for Owner/Manager verification and password reset?
- Waiter app: native (Expo) or PWA for the first pilot?
- Tax handling: GST inclusive or exclusive pricing?
- Receipt printing required for the pilot, or screen-only?
- Number of concurrent devices per restaurant (sizing sockets, DB pools, Redis)?
- Prisma version: stay on a Prisma 6 line or start on Prisma 7 (driver adapters, `prisma.config.ts`)?
- Keep `uuid` ids for auth tables (`@db.Uuid`) or accept Better Auth's default `text` ids to avoid post-generate scripting?# ServIO
