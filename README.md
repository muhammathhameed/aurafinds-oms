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
