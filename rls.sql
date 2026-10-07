-- ─────────────────────────────────────────────────────────────────────────────
-- Servio: Row-Level Security for tenant-owned tables.
-- Add to a migration created with:  prisma migrate dev --create-only --name rls
-- Prisma does not model RLS, so this SQL is hand-maintained. Re-run the table
-- list when you add a tenant-owned table (a CI test should assert coverage).
--
-- The tenant variable is set per transaction by withTenant():
--   SELECT set_config('app.current_restaurant', '<uuid>', TRUE);
-- After the transaction ends it resets to '' (not NULL), hence the NULLIF.
-- Missing/empty variable => NULL => policy matches nothing (fails closed).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'stations', 'tables', 'categories', 'menu_items', 'modifier_groups', 'modifiers',
    'orders', 'order_items', 'order_item_modifiers', 'kitchen_tickets',
    'bills', 'payments', 'idempotency_keys', 'audit_logs',
    'document_counters', 'daily_sales_summaries'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (restaurant_id = NULLIF(current_setting('app.current_restaurant', true), '')::uuid)
        WITH CHECK (restaurant_id = NULLIF(current_setting('app.current_restaurant', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;

-- restaurants: the row IS the tenant, so the key is id.
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurants;
CREATE POLICY tenant_isolation ON restaurants
  USING      (id = NULLIF(current_setting('app.current_restaurant', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_restaurant', true), '')::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Roles (run once per environment, outside Prisma migrations or in a bootstrap
-- migration). Three roles:
--   servio_owner    owns the schema, runs `prisma migrate deploy`
--   servio_app      runtime for domain code (subject to RLS, DML only)
--   servio_auth     runtime for Better Auth's Prisma client (auth tables only)
--
-- CREATE ROLE servio_app  LOGIN PASSWORD '...' NOINHERIT;
-- CREATE ROLE servio_auth LOGIN PASSWORD '...' NOINHERIT;
--
-- GRANT USAGE ON SCHEMA public TO servio_app, servio_auth;
--
-- -- domain tables: app role only
-- GRANT SELECT, INSERT, UPDATE, DELETE ON
--   restaurants, stations, tables, categories, menu_items, modifier_groups, modifiers,
--   orders, order_items, order_item_modifiers, kitchen_tickets, bills, payments,
--   idempotency_keys, audit_logs, document_counters, daily_sales_summaries
--   TO servio_app;
--
-- -- auth tables: auth role writes; app role may only read (staff lists, report joins)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON
--   "user", session, account, verification, organization, member, invitation,
--   device, staff_pin, manager_approval
--   TO servio_auth;
-- GRANT SELECT ON "user", member, organization, device TO servio_app;
--
-- -- Better Auth also needs to create the restaurants row (afterCreate hook):
-- --   do it through servio_app inside withTenant(orgId), not from servio_auth.
--
-- -- Background jobs enumerate tenants from the (non-RLS) organization table via
-- -- the read grant above, then process each restaurant inside withTenant().
-- ─────────────────────────────────────────────────────────────────────────────
