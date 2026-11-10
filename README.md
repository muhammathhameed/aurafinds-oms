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
Apply `supabase/migrations/20261110000200_oms_dashboard.sql`, set `CRON_SECRET` in Vercel (a cron runs the detector every 15 minutes; Hobby plans only allow daily crons), and use **Alerts → Run checks now** for an immediate scan.
It reads the storefront's CJ fulfillment fields (`orders.fulfillment_status`). Do not apply the dropship engine's `20261108000100_dropship_core.sql`: it defines a conflicting `fulfillment_status`.
