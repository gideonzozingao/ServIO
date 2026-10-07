# Servio: NestJS MVP Modules and Schema Design

**Companion to:** MVP Architecture v4 (NestJS + Better Auth + Prisma)
**Schema files:** `prisma/schema/base.prisma`, `auth.prisma` (Better Auth, generated), `domain.prisma`, `prisma/sql/rls.sql`

> Verify Prisma and Better Auth option names against the versions you install (see the v4 verification note).

---

## 1. Schema Summary

### Ownership
| File | Owner | Contents |
|---|---|---|
| `auth.prisma` | Better Auth CLI (never hand-edit) | `user, session, account, verification, organization, member, invitation` + plugin tables `device, staff_pin, manager_approval` |
| `domain.prisma` | App | 17 models below |
| `rls.sql` | App (hand-written SQL in a migration) | RLS policies, role grants |

### Domain models
```
Restaurant (id = organization.id)
 ├─ Station
 ├─ DiningTable
 ├─ Category ─< MenuItem >─ Station
 │               └─< ModifierGroup ─< Modifier
 ├─ Order ─< OrderItem ─< OrderItemModifier
 │    │         └── ticketId → KitchenTicket (per order, station, round)
 │    └─< Bill ─< Payment
 ├─ DocumentCounter      (atomic per-day order/bill numbers)
 ├─ IdempotencyKey       (replay protection)
 ├─ AuditLog
 └─ DailySalesSummary    (nightly rollup)
```

### Enums
`TableStatus` (FREE, OCCUPIED, RESERVED) · `OrderType` (DINE_IN, TAKEAWAY) · `OrderStatus` (OPEN … PAID, CANCELLED, VOIDED) · `ItemStatus` (PENDING, PREPARING, READY, SERVED, VOIDED) · `TicketStatus` (NEW, PREPARING, READY, SERVED, CANCELLED) · `BillStatus` (OPEN, PAID, VOID) · `PaymentMethod` (CASH, CARD, MOBILE_MONEY, OTHER) · `CounterScope` (ORDER, BILL)

### Changes and decisions relative to v4
1. **`restaurant_id` on every tenant table**, including children (`order_items`, `modifiers`, `payments`...). The tenant extension and RLS both need it on the row itself; joins would defeat the point.
2. **Soft references to Better Auth rows** (`waiter_id`, `received_by_id`, `voided_by_id`, `approver_id`...): plain `uuid` columns, no `@relation`, no FK. Prisma requires a back-relation field on the other side of every `@relation`; those fields would live in the generated `auth.prisma` and be wiped on the next `better-auth generate`. Prisma's migration diff also drops FKs that exist in the database but not in the schema, so adding the FKs in raw SQL is not an option. Integrity holds because users are deactivated, never deleted. Staff names for display come from `StaffDirectoryService` (batch lookup by id) or a tagged `$queryRaw` join in reports.
   *Alternative:* keep real relations and run a post-generate script that re-inserts the back-relations into `auth.prisma`. Stronger integrity, more fragile tooling.
3. `Restaurant.id` equals `organization.id` with no relation, same reason. It is created in the organization `afterCreate` hook.
4. **`KitchenTicket.round`**: items added after the first send fire a new ticket (round 2) so the kitchen only sees the new items. Unique `(orderId, stationId, round)`.
5. **`OrderItem.ticketId`** links items to the ticket they were fired on (null until sent).
6. **`DocumentCounter`** gives readable per-day order and bill numbers without table locks.
7. **`DailySalesSummary`** is a durable nightly rollup (Redis caches reads on top).
8. `MenuItem.archivedAt` soft-deletes menu items; history keeps its snapshots.
9. `Payment.tenderedMinor` supports cash change calculation. Split bills in the MVP mean **split payments** on one bill; per-item bill splitting is post-MVP.
10. Printer model omitted (printing is post-MVP). `Station` has no printer column yet.
11. Enums are upper-case (`DINE_IN`); v4 used lower-case.

---

## 2. Module Dependency Graph

Rule: **imports flow downward only; no cycles.** Cross-module reads go through exported services; writes to another module's tables go through that module's service.

```
                     ┌──────────────── order-flow ────────────────┐
                     │ (use cases: send, ticket progress, void,   │
                     │  bill, pay; owns the cross-module routes)  │
                     └──┬────────┬────────┬────────┬────────┬─────┘
                        ▼        ▼        ▼        ▼        ▼
                     orders   kitchen  billing   floor   catalog (read)
                        │
                        ├──▶ catalog (pricing)
                        └──▶ floor   (table occupancy)

 staff ──▶ auth            reporting (read-only SQL)       settings
 realtime ◀── events (no imports of domain modules)         jobs ──▶ reporting, idempotency, auth

 Global infrastructure (imported everywhere): ConfigModule, DatabaseModule,
 TenancyModule, EventsModule, AuditModule, IdempotencyModule, HealthModule
```

**Why an `order-flow` module:** sending an order touches orders, kitchen, floor and audit in one transaction, and a ticket status change must roll up to the order. Putting those use cases in `orders` or `kitchen` would create an `orders ⇄ kitchen` cycle. `order-flow` sits above them and orchestrates; `orders` handles draft-order CRUD and reads, `kitchen` handles ticket reads/state, `billing` handles bill and payment records.

---

## 3. Infrastructure Modules (global)

### 3.1 `DatabaseModule`
| Provider | Responsibility |
|---|---|
| `PrismaService` | Base `PrismaClient` with the `@prisma/adapter-pg` driver adapter, lifecycle hooks, query-event logging. Runtime role `servio_app` |
| `AuthPrismaClient` | Separate base client for Better Auth (role `servio_auth`). Exported only to `AuthModule` |
| `TenantPrismaService` | Returns a tenant-scoped client for the current request: extension injects `restaurantId` into `where`/`data` for tenant models |
| `withTenant(prisma, restaurantId, fn)` | Interactive transaction that first runs `set_config('app.current_restaurant', $1, TRUE)`, then `fn(tx)`; used by every use case |
| `AuthModelGuardExtension` | Throws on `create/update/delete/upsert` against Better Auth models outside `AuthModule` |
| `DocumentNumberService` | `next(tx, scope, businessDate)` using the atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `document_counters` |

### 3.2 `TenancyModule`
- `TenantContext` (AsyncLocalStorage via `nestjs-cls`): `{ userId, restaurantId, role, deviceId, businessDate }`.
- `SessionGuard` (global): `auth.api.getSession({ headers })` → populates the context; `@Public()` opts out.
- `businessDate` derived from the restaurant timezone and an optional day-rollover hour setting.

### 3.3 `IdempotencyModule`
- `IdempotencyInterceptor` on routes tagged `@Idempotent()`: reads `Idempotency-Key`, hashes the request, stores/replays from `idempotency_keys`; same key with a different hash → 409.
- The unique `(restaurant_id, key, scope)` constraint is the final guard against races. Cleanup runs in the `maintenance` job.

### 3.4 `EventsModule`
- Wraps `@nestjs/event-emitter` with a typed `DomainEvents` catalog (§7).
- **Rule:** events are emitted only after `withTenant` resolves (post-commit).

### 3.5 `AuditModule`
- `AuditService.record(tx, entry)` writes inside the caller's transaction (so audit and action commit together).
- `AuditController`: `GET /api/v1/audit-logs` (owner/manager, filters: action, subject, date).

### 3.6 `HealthModule`
- `@nestjs/terminus`: DB ping, Redis ping, queue depth. Public `/health/live` and `/health/ready`.

---

## 4. Domain Modules

Permissions use the Better Auth statements: `menu`, `order`, `ticket`, `bill`, `report`, `staff`, `settings`.

### 4.1 `auth`
| Aspect | Detail |
|---|---|
| Owns | Better Auth instance, organization access control (`ac`, `roles`), `staffDevice` plugin, manager-approval verification |
| Exposes | `/api/auth/*` (Better Auth handler) incl. `/staff/pin-login`, `/staff/roster`, `/staff/devices`, `/staff/set-pin`, `/staff/manager-approval` |
| Providers | `AuthService` (wraps `auth.api.*`), `PermissionGuard` (`@RequirePermission(resource, action)`), `ManagerApprovalGuard` (`X-Approval-Token`), `CurrentSession` decorator |
| Depends on | `AuthPrismaClient`, Redis (`secondaryStorage`), mailer |
| Hooks | Organization `afterCreate` → create `Restaurant` (same id) and default `Station`s in `withTenant` |
| Rules | Only module allowed to write Better Auth models; PIN endpoints peppered, rate-limited, locked out after N failures |

### 4.2 `staff`
| Aspect | Detail |
|---|---|
| Owns | No tables. Staff directory over `user`/`member`/`device` (read) and admin actions that call `AuthService` |
| Routes | `GET /staff` · `POST /staff` (create floor staff: placeholder email, member role, no credential account) · `PATCH /staff/:id` (role, active) · `POST /staff/:id/pin` · `GET /devices` · `POST /devices` · `POST /devices/:id/revoke` |
| Permission | `staff:manage` (owner) for create/role changes; manager may reset waiter PINs |
| Providers | `StaffService`, `StaffDirectoryService.namesByIds(ids)` (used by orders, billing, reporting, audit to resolve display names) |
| Events | `device.revoked`, `staff.deactivated` → realtime disconnects sockets |

### 4.3 `settings`
| Aspect | Detail |
|---|---|
| Owns | `Restaurant`, `Station` |
| Routes | `GET/PATCH /settings/restaurant` (currency, tax rate bps, inclusive/exclusive, timezone, settings JSON) · CRUD `/stations` |
| Permission | `settings:manage` |
| Providers | `RestaurantSettingsService.get()` (cached in Redis, invalidated on update) — consumed by orders/billing for tax rules |

### 4.4 `catalog`
| Aspect | Detail |
|---|---|
| Owns | `Category`, `MenuItem`, `ModifierGroup`, `Modifier` |
| Routes | `GET /menu` (full tree, ETag, cached) · CRUD `/categories` · CRUD `/menu-items` · `PATCH /menu-items/:id/availability` · CRUD `/menu-items/:id/modifier-groups`, `/modifier-groups/:id/modifiers` |
| Permission | read: any role; write: `menu:manage`. Availability toggle: manager or kitchen lead via `menu:manage` |
| Providers | `CatalogService`, `MenuQueryService.getPricedItems(tx, ids, modifierIds)` (used by orders to snapshot name/price and validate availability and modifier min/max) |
| Events | `menu.updated` (invalidate cache, notify clients), `menu.item.availability.changed` (realtime to waiters) |
| Rules | Price/name changes write `AuditLog` (`menu.price_change`); archive instead of delete when an item has order history |

### 4.4 `floor`
| Aspect | Detail |
|---|---|
| Owns | `DiningTable` |
| Routes | `GET /tables` (with current open order summary) · CRUD `/tables` · `PATCH /tables/:id/status` |
| Permission | read: any role; write: `settings:manage`; status change: `order:update` |
| Providers | `FloorService.occupy(tx, tableId, orderId)`, `FloorService.release(tx, tableId)` (called by order-flow) |
| Events | `table.status.changed` |
| Rules | One open dine-in order per table at a time (checked in `occupy` under the transaction) |

### 4.5 `orders` (draft-order CRUD and reads)
| Aspect | Detail |
|---|---|
| Owns | `Order`, `OrderItem`, `OrderItemModifier` (writes while status is OPEN, plus read models) |
| Routes | `POST /orders` (`@Idempotent`) · `GET /orders?status=&table=&waiter=` · `GET /orders/:id` · `POST /orders/:id/items` · `PATCH /orders/:id/items/:itemId` · `DELETE /orders/:id/items/:itemId` (only before send) |
| Permission | `order:create`, `order:update`; waiters see only their own open orders unless manager |
| Providers | `OrdersService`, `OrderPricingService` (line totals, subtotal, tax, discount, total; always server-side), `OrderQueryService` |
| Depends on | `catalog` (pricing snapshot), `floor` (table validity), `settings` (tax rules), `DocumentNumberService` |
| Events | `order.created`, `order.items.changed` |
| Rules | Item add snapshots `name`, `unitPriceMinor`, modifier names/deltas; rejects unavailable items; items added after SENT_TO_KITCHEN stay PENDING until the next `send` (new round); order id may be client-supplied (UUID) for offline creation |

### 4.6 `kitchen`
| Aspect | Detail |
|---|---|
| Owns | `KitchenTicket` reads and ticket-state persistence primitives |
| Routes | `GET /kitchen-tickets?station=&status=` (KDS board, includes items) · `GET /kitchen-tickets/:id` |
| Permission | `ticket:read` |
| Providers | `TicketService.fire(tx, order, items)` (groups items by station → one ticket per station for the next round), `TicketService.setStatus(tx, ticketId, status)` (validated transitions), `TicketQueryService` |
| Events | `ticket.created`, `ticket.updated`, `ticket.ready` |
| Rules | Ticket transitions: NEW → PREPARING → READY → SERVED (CANCELLED on void); the status write is exposed through order-flow because it must roll up to the order and items |

### 4.7 `billing`
| Aspect | Detail |
|---|---|
| Owns | `Bill`, `Payment` |
| Routes (reads) | `GET /bills/:id` · `GET /orders/:id/bills` |
| Permission | `bill:create`, `bill:pay`, `bill:discount` |
| Providers | `BillService.createFromOrder(tx, order, createdBy)` (snapshot totals, next bill number), `BillService.applyDiscount(tx, bill, discountMinor, reason, approvalId)`, `PaymentService.record(tx, bill, dto)` (sum check, change calc, marks bill PAID when covered), `TaxService` |
| Events | `bill.created`, `payment.recorded`, `bill.paid` |
| Rules | Payments can never exceed the remaining balance; cash `tenderedMinor >= amountMinor`; bills are voided, not deleted; a bill's totals are frozen at creation (discount recomputes totals once, audited) |

### 4.8 `order-flow` (orchestration)
Owns the routes that cross module boundaries and runs each as a single `withTenant` transaction.

| Route | Use case | Permission / guard |
|---|---|---|
| `POST /orders/:id/send` | `SendOrderUseCase` | `order:update` |
| `PATCH /kitchen-tickets/:id` | `AdvanceTicketUseCase` | `ticket:update` |
| `POST /orders/:id/serve` | `ServeOrderUseCase` (mark READY tickets/items served) | `order:update` |
| `POST /orders/:id/bill` | `CreateBillUseCase` | `bill:create` |
| `POST /bills/:id/payments` (`@Idempotent`) | `RecordPaymentUseCase` | `bill:pay` |
| `POST /bills/:id/discount` | `ApplyDiscountUseCase` | `bill:discount` + `X-Approval-Token` |
| `POST /orders/:id/void` | `VoidOrderUseCase` | `order:void` + `X-Approval-Token` |
| `POST /orders/:id/items/:itemId/void` | `VoidItemUseCase` | `order:void` + `X-Approval-Token` after send |

**`SendOrderUseCase` (sketch)**

```ts
@Injectable()
export class SendOrderUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly tickets: TicketService,
    private readonly floor: FloorService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly ctx: TenantContext,
  ) {}

  async execute(orderId: string) {
    const { restaurantId, userId } = this.ctx.get();

    const result = await withTenant(this.prisma, restaurantId, async (tx) => {
      const order = await this.orders.getForUpdate(tx, orderId);          // SELECT … FOR UPDATE
      if (order.status !== 'OPEN' && order.status !== 'SENT_TO_KITCHEN') {
        throw new UnprocessableEntityException('Order cannot be sent');
      }

      const pending = order.items.filter((i) => i.status === 'PENDING' && !i.voidedAt);
      if (pending.length === 0) throw new UnprocessableEntityException('Nothing to send');

      const tickets = await this.tickets.fire(tx, order, pending);         // one ticket per station, next round
      await this.orders.markSent(tx, order, tickets);                      // status, sentAt, item.ticketId
      if (order.tableId) await this.floor.occupy(tx, order.tableId, order.id);
      await this.audit.record(tx, { action: 'order.send', subjectType: 'order', subjectId: order.id, userId });

      return { orderId: order.id, tickets };
    });

    // after commit
    this.events.emit('order.sent', { restaurantId, ...result });
    for (const t of result.tickets) this.events.emit('ticket.created', { restaurantId, ticketId: t.id, stationId: t.stationId });
    return result;
  }
}
```

**`AdvanceTicketUseCase` rollup:** after updating the ticket (and its items), recompute order status inside the same transaction: any ticket PREPARING → order PREPARING; all active tickets READY → order READY; all SERVED → SERVED. Use a conditional update (`updateMany({ where: { id, status: from }, data })`, check `count === 1`) to survive concurrent bumps.

**`RecordPaymentUseCase`:** locks the bill row, validates remaining balance, inserts the payment, and when the balance reaches zero marks the bill PAID, the order PAID, closes the order, and releases the table. Emits `payment.recorded`, `bill.paid`, `order.closed` after commit.

**Approval-guarded use cases** consume the manager approval token in the same transaction as the action, and write `approverId` into `AuditLog`.

### 4.9 `realtime`
| Aspect | Detail |
|---|---|
| Owns | Socket.IO gateway `/rt`, Redis adapter |
| Providers | `RealtimeGateway`, `RoomService` |
| Handshake | `auth.api.getSession` from cookie or `auth.token`; rejects without `activeOrganizationId` |
| Rooms | `r:{restaurantId}:all`, `:waiters`, `:admin`, `:station:{stationId}` (station join validated against role) |
| Consumes events | `ticket.created`, `ticket.updated`, `ticket.ready`, `table.status.changed`, `menu.item.availability.changed`, `order.closed`, `device.revoked`, `staff.deactivated` |
| Rules | Imports no domain modules; payloads are minimal ids + display fields, clients refetch details. `device.revoked` disconnects that device's sockets |

### 4.10 `reporting`
| Aspect | Detail |
|---|---|
| Owns | `DailySalesSummary` (written by job) |
| Routes | `GET /reports/daily?date=` · `GET /reports/top-items?from=&to=` · `GET /reports/staff?from=&to=` · `GET /reports/voids?from=&to=` |
| Permission | `report:read` |
| Providers | `ReportQueryService` (Prisma `groupBy`/`aggregate` and tagged `$queryRaw` for heavy aggregates; read-only), `DailyRollupService` (idempotent upsert per `(restaurant, date)`), `StaffDirectoryService` for names |
| Caching | Redis per `(restaurant, report, params)`; today's report short TTL, past dates long |

### 4.11 `jobs` (BullMQ)
| Queue | Processor | Notes |
|---|---|---|
| `reports` | `DailyRollupProcessor` | Nightly per restaurant (in its timezone); manual recompute |
| `maintenance` | `CleanupProcessor` | Expired `idempotency_keys`, expired/consumed `manager_approval`, stale sessions |
| `notifications` | `PushProcessor` | Waiter push (ticket ready) |
| `print` | (post-MVP) | Receipts and kitchen tickets |

- Runs in the `worker` container (`main.worker.ts`).
- Enumerates restaurants from the non-RLS `organization` table, then runs each unit inside `withTenant(restaurantId)` so RLS applies to background work.

---

## 5. Controller and DTO Conventions
- Route prefix `/api/v1`; Better Auth owns `/api/auth/*`.
- DTOs: `class-validator` + `class-transformer`; `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Clients never send totals, prices, or names for order items (only `menuItemId`, `qty`, `modifierIds`, `notes`); the server computes everything.
- Response shapes are explicit DTO classes (never raw Prisma models) so `BigInt`, internal columns and soft-ref ids do not leak.
- Global exception filter maps Prisma errors: `P2002` → 409, `P2025` → 404, `P2003` → 409; domain exceptions → 422.
- Pagination: cursor-based (`cursor`, `limit`), stable sort by `(createdAt, id)`.
- OpenAPI via `@nestjs/swagger`; the generated client feeds `packages/api-client`.

---

## 6. Permission Map
| Route area | Permission |
|---|---|
| `GET /menu`, `/tables` | any authenticated role |
| Menu write | `menu:manage` |
| Create/edit order, add items, send, serve | `order:create` / `order:update` |
| Ticket list | `ticket:read` |
| Ticket advance | `ticket:update` |
| Create bill | `bill:create` |
| Record payment | `bill:pay` |
| Discount | `bill:discount` + approval token |
| Void order/item | `order:void` + approval token |
| Reports, audit log | `report:read` |
| Staff, devices, settings | `staff:manage`, `settings:manage` |

---

## 7. Domain Event Catalog
| Event | Emitted by | Payload (ids + essentials) | Consumers |
|---|---|---|---|
| `order.created` | orders | orderId, tableId, type | realtime (admin) |
| `order.sent` | order-flow | orderId, ticketIds | realtime, audit |
| `ticket.created` | order-flow | ticketId, stationId, orderId | realtime (station room) |
| `ticket.updated` | order-flow | ticketId, status | realtime (station + waiters) |
| `ticket.ready` | order-flow | ticketId, orderId, tableLabel | realtime (waiters), notifications job |
| `order.status.changed` | order-flow | orderId, from, to | realtime |
| `table.status.changed` | floor | tableId, status | realtime (waiters) |
| `menu.item.availability.changed` | catalog | menuItemId, available | realtime (all) |
| `menu.updated` | catalog | version | cache invalidation |
| `bill.created` | order-flow | billId, orderId | realtime (admin) |
| `payment.recorded` | order-flow | billId, paymentId, method | reporting cache invalidation |
| `bill.paid` / `order.closed` | order-flow | billId / orderId | realtime, reporting |
| `device.revoked` / `staff.deactivated` | staff/auth | deviceId / userId | realtime (disconnect) |

---

## 8. Wiring

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    EventEmitterModule.forRoot({ wildcard: false }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    ThrottlerModule.forRoot({ /* redis storage */ }),

    // global infrastructure
    DatabaseModule, TenancyModule, EventsModule, AuditModule, IdempotencyModule, HealthModule,

    // identity
    AuthModule, StaffModule,

    // domain
    SettingsModule, CatalogModule, FloorModule, OrdersModule, KitchenModule, BillingModule,

    // orchestration and delivery
    OrderFlowModule, RealtimeModule, ReportingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
```
`JobsModule` is imported by `WorkerModule` (worker entrypoint), not by `AppModule`.

---

## 9. Build Order (maps to the v4 phases)
1. `DatabaseModule`, `TenancyModule`, base schema, `AuthModule` (Better Auth + organization + access control), migrations pipeline, RLS SQL, tenancy tests
2. `staffDevice` plugin (devices, PIN, approvals) + `StaffModule`
3. `SettingsModule`, `CatalogModule`, `FloorModule`
4. `OrdersModule` (+ pricing, counters, idempotency) and `OrderFlow` send/serve
5. `KitchenModule`, `AdvanceTicketUseCase`, `RealtimeModule`
6. `BillingModule`, payment/discount/void use cases, `AuditModule` views
7. `ReportingModule`, `JobsModule`
8. Offline hardening, load test, pilot

## 10. Open Points
- Keep soft refs to Better Auth rows, or adopt the post-generate back-relation script?
- Day-rollover hour for `businessDate` (restaurants open past midnight)?
- Do waiters see only their own orders, or all open orders for the restaurant?
- Per-item void after send: manager approval for every item, or only after the item reaches PREPARING?
- Tax: inclusive vs exclusive prices (`pricesIncludeTax` default is a placeholder)