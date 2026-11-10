-- OMS foundation: admin roles (RBAC) and an append-only audit log.
-- The OMS shares this database with the storefront; being a Supabase Auth user
-- grants nothing here. Only a row in admin_users does.

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('super_admin', 'ops_admin', 'customer_service', 'fulfillment', 'finance')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_key
  ON public.admin_users (lower(email));

-- Role of the calling user, or NULL if they are not an active admin.
CREATE OR REPLACE FUNCTION public.oms_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.admin_users WHERE user_id = auth.uid() AND active;
$$;

-- Never leave the system without an active super admin.
CREATE OR REPLACE FUNCTION public.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'super_admin' AND OLD.active)
     OR (TG_OP = 'UPDATE' AND OLD.role = 'super_admin' AND OLD.active
         AND (NEW.role <> 'super_admin' OR NOT NEW.active)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_users
       WHERE role = 'super_admin' AND active AND user_id <> OLD.user_id
    ) THEN
      RAISE EXCEPTION 'last_super_admin';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_users_guard ON public.admin_users;
CREATE TRIGGER admin_users_guard
  BEFORE UPDATE OR DELETE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_super_admin();

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, at DESC);

CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_is_append_only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_change ON public.audit_log;
CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_immutable();

-- Single write path; role and email are read from admin_users, not trusted
-- from the caller.
CREATE OR REPLACE FUNCTION public.write_audit(
  p_actor_id uuid,
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_role text;
  v_id bigint;
BEGIN
  SELECT email, role INTO v_email, v_role
    FROM public.admin_users WHERE user_id = p_actor_id;
  INSERT INTO public.audit_log (actor_id, actor_email, actor_role, action,
                                entity_type, entity_id, before, after, meta)
  VALUES (p_actor_id, v_email, v_role, p_action, p_entity_type, p_entity_id,
          p_before, p_after, COALESCE(p_meta, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- One-time bootstrap: only works while there are no admins at all.
CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  LOCK TABLE public.admin_users IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.admin_users) THEN
    RAISE EXCEPTION 'admins_already_exist';
  END IF;
  INSERT INTO public.admin_users (user_id, email, role, created_by)
  VALUES (p_user_id, p_email, 'super_admin', p_user_id);
  PERFORM public.write_audit(p_user_id, 'admin.bootstrap', 'admin_user', p_user_id::text);
END;
$$;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins may read their own row (so the portal can show who they are).
DROP POLICY IF EXISTS admin_users_self_read ON public.admin_users;
CREATE POLICY admin_users_self_read ON public.admin_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Audit log is readable by oversight roles only; there is no write policy.
DROP POLICY IF EXISTS audit_log_oversight_read ON public.audit_log;
CREATE POLICY audit_log_oversight_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.oms_role() IN ('super_admin', 'ops_admin', 'finance'));

REVOKE ALL ON public.admin_users, public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_users, public.audit_log TO authenticated;
GRANT ALL ON public.admin_users, public.audit_log TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'write_audit(uuid, text, text, text, jsonb, jsonb, jsonb)',
    'bootstrap_first_super_admin(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.oms_role() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.oms_role() TO authenticated, service_role;
END;
$$;

-- Lets the OMS grant a role to an existing Supabase Auth user by email.
CREATE OR REPLACE FUNCTION public.find_auth_user_id(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_auth_user_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_id(text) TO service_role;
