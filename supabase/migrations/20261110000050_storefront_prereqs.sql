-- Run this BEFORE the other OMS Phase 2+ migrations.
-- The OMS reads these storefront columns. Your database may be missing some if
-- the storefront's own migrations haven't all been applied; this adds only what
-- is missing (every statement is IF NOT EXISTS, so it is safe to run any time and
-- does not conflict with the storefront migrations if you apply them later).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS total_amount bigint,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS shipping_details jsonb,
  ADD COLUMN IF NOT EXISTS cj_order_id text,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS fulfillment_error text,
  ADD COLUMN IF NOT EXISTS fulfillment_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_carrier text,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS tracking_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS supplier_id text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS public.product_cj_variants (
  product_id text PRIMARY KEY,
  cj_variant_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_cj_variants_product_id_nonempty CHECK (length(product_id) > 0),
  CONSTRAINT product_cj_variants_cj_variant_id_nonempty CHECK (length(cj_variant_id) BETWEEN 1 AND 50)
);
ALTER TABLE public.product_cj_variants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_cj_variants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_cj_variants TO service_role;

NOTIFY pgrst, 'reload schema';
