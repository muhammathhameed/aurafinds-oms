-- OMS Phase 4: supplier registry, CJ performance metrics, unmapped-product alert.
-- Named oms_suppliers so it can never collide with a future `suppliers` table.
CREATE TABLE IF NOT EXISTS public.oms_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[a-z0-9_-]{2,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  contact_email text,
  handling_days integer NOT NULL DEFAULT 3 CHECK (handling_days BETWEEN 0 AND 60),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS oms_suppliers_code_key ON public.oms_suppliers (code);

INSERT INTO public.oms_suppliers (code, name, status, handling_days)
VALUES ('cj', 'CJ Dropshipping', 'approved', 3)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.oms_suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oms_suppliers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.oms_suppliers TO service_role;

-- CJ is the only supplier the storefront submits to today, so every paid order
-- is attributed to it. Revisit when a second supplier is wired in.
CREATE OR REPLACE FUNCTION public.oms_supplier_performance(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH o AS (
    SELECT * FROM public.orders
     WHERE payment_status = 'paid'
       AND created_at >= now() - make_interval(days => GREATEST(p_days, 1))
  )
  SELECT jsonb_build_object(
    'days', GREATEST(p_days, 1),
    'paid_orders', (SELECT count(*) FROM o),
    'submitted', (SELECT count(*) FROM o WHERE fulfillment_submitted_at IS NOT NULL),
    'failed', (SELECT count(*) FROM o WHERE fulfillment_status = 'failed'),
    'shipped', (SELECT count(*) FROM o WHERE fulfillment_status = 'shipped'),
    'overdue_tracking', (SELECT count(*) FROM o
        WHERE fulfillment_status = 'processing' AND tracking_number IS NULL
          AND fulfillment_submitted_at < now() - interval '5 days'),
    'avg_submit_hours', (SELECT round((avg(extract(epoch FROM fulfillment_submitted_at - created_at)) / 3600)::numeric, 1)
        FROM o WHERE fulfillment_submitted_at IS NOT NULL),
    'avg_ship_days', (SELECT round((avg(extract(epoch FROM shipped_at - fulfillment_submitted_at)) / 86400)::numeric, 1)
        FROM o WHERE shipped_at IS NOT NULL AND fulfillment_submitted_at IS NOT NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.oms_supplier_performance(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oms_supplier_performance(integer) TO service_role;

-- Orders for a product with no CJ variant stay pending forever, so flag it.
CREATE OR REPLACE VIEW public.oms_alert_candidates AS
  SELECT * FROM (
    SELECT 'order.fulfillment_failed'::text AS kind, 'high'::text AS severity,
           'order'::text AS entity_type, o.id::text AS entity_id,
           'Supplier fulfillment failed'::text AS title,
           jsonb_build_object('error', o.fulfillment_error, 'created_at', o.created_at) AS detail,
           'order.fulfillment_failed:' || o.id::text AS dedupe_key
      FROM public.orders o
     WHERE o.payment_status = 'paid' AND o.fulfillment_status = 'failed'
    UNION ALL
    SELECT 'order.fulfillment_stuck',
           CASE WHEN o.created_at < now() - interval '2 hours' THEN 'high' ELSE 'medium' END,
           'order', o.id::text, 'Paid order not submitted to supplier',
           jsonb_build_object('status', o.fulfillment_status, 'created_at', o.created_at),
           'order.fulfillment_stuck:' || o.id::text
      FROM public.orders o
     WHERE o.payment_status = 'paid' AND o.fulfillment_status IN ('pending', 'submitting')
       AND o.created_at < now() - interval '30 minutes'
    UNION ALL
    SELECT 'order.tracking_missing', 'medium', 'order', o.id::text,
           'No tracking number after 5 days',
           jsonb_build_object('submitted_at', o.fulfillment_submitted_at, 'cj_order_id', o.cj_order_id),
           'order.tracking_missing:' || o.id::text
      FROM public.orders o
     WHERE o.payment_status = 'paid' AND o.fulfillment_status = 'processing'
       AND o.tracking_number IS NULL AND o.fulfillment_submitted_at < now() - interval '5 days'
    UNION ALL
    SELECT 'product.negative_margin', 'high', 'product', p.id::text,
           'Active product priced below cost',
           jsonb_build_object('price', p.price, 'cost_price', p.cost_price),
           'product.negative_margin:' || p.id::text
      FROM public.products p
     WHERE p.status = 'active' AND p.cost_price IS NOT NULL AND p.price < p.cost_price
    UNION ALL
    SELECT 'product.missing_image', 'medium', 'product', p.id::text,
           'Active product has no image', jsonb_build_object('name', p.name),
           'product.missing_image:' || p.id::text
      FROM public.products p
     WHERE p.status = 'active' AND (p.image_url IS NULL OR btrim(p.image_url) = '')
    UNION ALL
    SELECT 'product.unmapped_cj', 'medium', 'product', p.id::text,
           'Active product has no CJ variant mapping (orders will not fulfil)',
           jsonb_build_object('name', p.name),
           'product.unmapped_cj:' || p.id::text
      FROM public.products p
     WHERE p.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.product_cj_variants m WHERE m.product_id = p.id::text)
  ) c;

NOTIFY pgrst, 'reload schema';
