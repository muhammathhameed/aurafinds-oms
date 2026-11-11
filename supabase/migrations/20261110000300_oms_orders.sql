-- OMS Phase 3: internal notes on orders. The timeline is derived from the
-- order's own timestamps, these notes and audit_log, so no events table is needed.
CREATE TABLE IF NOT EXISTS public.order_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email text,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_notes_order_idx ON public.order_notes (order_id, created_at DESC);

ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.order_notes TO service_role;

-- Speeds up the order list's sort and email search.
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_idx ON public.orders (lower(customer_email));

NOTIFY pgrst, 'reload schema';
