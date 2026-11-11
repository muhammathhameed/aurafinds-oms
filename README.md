# AuraFinds OMS (admin portal)

Standalone Next.js app for internal operations. It shares the storefront's
Supabase project; being a Supabase Auth user grants nothing here, only an
active row in `admin_users` does.

## Setup
1. Apply `supabase/migrations/20261110000100_oms_rbac_audit.sql`.
2. Deploy this repo as its own Vercel project with the env vars in
   `.env.example`.
3. Create your own account in Supabase Auth, then in the SQL editor run once:
   `select public.bootstrap_first_super_admin('<your auth user id>', '<your email>');`
   It refuses to run again once any admin exists.
4. Sign in at `/login`; add teammates under **Admins**.

RBAC lives in `shared/rbac.ts` (tests in `tests/`, run `npm test`).
Every privileged action must call `requirePermission(...)` and `audit(...)`.

## Phase 2: dashboard and alerts
Apply `supabase/migrations/20261110000200_oms_dashboard.sql`, set `CRON_SECRET` in Vercel (a daily cron runs the detector; for more frequent runs, have n8n call `GET /api/cron/detect` with `Authorization: Bearer $CRON_SECRET`), and use **Alerts → Run checks now** for an immediate scan.
It reads the storefront's CJ fulfillment fields (`orders.fulfillment_status`). Do not apply the dropship engine's `20261108000100_dropship_core.sql`: it defines a conflicting `fulfillment_status`.

## Phase 3: orders
Apply `supabase/migrations/20261110000300_oms_orders.sql`. Set `STOREFRONT_URL` and `CJ_FULFILLMENT_SECRET` (same value as the storefront's) to enable **Retry supplier submission**; the OMS calls the storefront's `/api/fulfillment`, which refuses orders already sent to CJ. Refunds and returns come in Phase 5 (they need Stripe).

## Phase 4: suppliers
Apply `supabase/migrations/20261110000400_oms_suppliers.sql`. **Suppliers** lists the registry and CJ performance; **Product → CJ variant mapping** edits the storefront's `product_cj_variants` table, and the alert detector now flags active products with no mapping. The storefront fulfils only through CJ, so there is no separate PO creation or supplier recommendation yet (both need a second supplier wired into the storefront).

## Phase 5: returns, refunds, shipments
Apply `supabase/migrations/20261110000500_oms_returns_refunds.sql`. Refunds need `STRIPE_SECRET_KEY` on the OMS: create a **restricted** key in Stripe with only *Refunds: Write* and *Checkout Sessions: Read*. Safeguards: the amount is reserved under a row lock before Stripe is called (no over-refunding, even with two admins at once), each refund row is Stripe's idempotency key (a retry can never refund twice), and an unknown outcome stays *pending* until you retry it. Who may refund is `orders.refund` in `shared/rbac.ts` (finance, ops admin, super admin). Refunds do not restock or cancel the CJ order; handle that with CJ separately.

## Phase 6: risk detection and assistant
Apply `supabase/migrations/20261110000600_oms_risk_rules.sql`. The detector now also covers duplicate orders, duplicate SKUs, invalid or undescribed products, low stock, broken image URLs (checked by the OMS server, 25 per run), repeat returns, repeat complaints, VIP customers with an order in trouble, and CJ return-rate / slow-shipping / failing-submission signals. All are plain SQL rules. The **Assistant** is read-only: each question maps to one fixed query (keyword match, or `GEMINI_API_KEY` as an optional fallback that only picks the query name). There are no AI-initiated actions. Dismissing an alert does not tune a rule; adjust the thresholds in the migration.
