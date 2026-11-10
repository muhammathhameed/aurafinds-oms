-- OMS Phase 2: operational alerts and dashboard KPIs.
-- Reads the storefront's orders / order_items / products as they exist on main
-- (CJ fulfillment: orders.fulfillment_status = pending|submitting|processing|shipped|failed).

CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- At most one live alert per condition; a resolved one can recur as a new row.
CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_live_key
  ON public.ops_alerts (dedupe_key) WHERE status IN ('open', 'acknowledged');
CREATE INDEX IF NOT EXISTS ops_alerts_status_idx
  ON public.ops_alerts (status, severity, last_seen DESC);

ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_alerts TO service_role;

-- Every condition the detector currently considers a problem.
CREATE OR REPLACE VIEW public.oms_alert_candidates AS
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
         'order', o.id::text,
         'Paid order not submitted to supplier',
         jsonb_build_object('status', o.fulfillment_status, 'created_at', o.created_at),
         'order.fulfillment_stuck:' || o.id::text
    FROM public.orders o
   WHERE o.payment_status = 'paid'
     AND o.fulfillment_status IN ('pending', 'submitting')
     AND o.created_at < now() - interval '30 minutes'
  UNION ALL
  SELECT 'order.tracking_missing', 'medium', 'order', o.id::text,
         'No tracking number after 5 days',
         jsonb_build_object('submitted_at', o.fulfillment_submitted_at, 'cj_order_id', o.cj_order_id),
         'order.tracking_missing:' || o.id::text
    FROM public.orders o
   WHERE o.payment_status = 'paid'
     AND o.fulfillment_status = 'processing'
     AND o.tracking_number IS NULL
     AND o.fulfillment_submitted_at < now() - interval '5 days'
  UNION ALL
  SELECT 'product.negative_margin', 'high', 'product', p.id::text,
         'Active product priced below cost',
         jsonb_build_object('price', p.price, 'cost_price', p.cost_price),
         'product.negative_margin:' || p.id::text
    FROM public.products p
   WHERE p.status = 'active' AND p.cost_price IS NOT NULL AND p.price < p.cost_price
  UNION ALL
  SELECT 'product.missing_image', 'medium', 'product', p.id::text,
         'Active product has no image',
         jsonb_build_object('name', p.name),
         'product.missing_image:' || p.id::text
    FROM public.products p
   WHERE p.status = 'active' AND (p.image_url IS NULL OR btrim(p.image_url) = '');

-- Idempotent: opens new alerts, refreshes live ones, auto-resolves cleared ones.
CREATE OR REPLACE FUNCTION public.oms_detect_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_opened integer;
  v_resolved integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.ops_alerts (kind, severity, entity_type, entity_id, title, detail, dedupe_key)
    SELECT kind, severity, entity_type, entity_id, title, detail, dedupe_key
      FROM public.oms_alert_candidates
    ON CONFLICT (dedupe_key) WHERE status IN ('open', 'acknowledged')
    DO UPDATE SET last_seen = now(), severity = EXCLUDED.severity, detail = EXCLUDED.detail
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted) INTO v_opened FROM ins;

  WITH res AS (
    UPDATE public.ops_alerts a
       SET status = 'resolved', resolved_at = now()
     WHERE a.status IN ('open', 'acknowledged')
       AND NOT EXISTS (
         SELECT 1 FROM public.oms_alert_candidates c WHERE c.dedupe_key = a.dedupe_key
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM res;

  RETURN jsonb_build_object('opened', v_opened, 'resolved', v_resolved);
END;
$$;

-- Dashboard numbers for the last p_days days. Money is integer cents.
-- Profit uses the product's CURRENT cost_price (no historical cost is stored),
-- and counts only lines whose product has a cost; lines_without_cost says how
-- many were skipped so the figure is never silently overstated.
CREATE OR REPLACE FUNCTION public.oms_dashboard_kpis(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH paid AS (
    SELECT o.id, o.total_amount, o.fulfillment_status
      FROM public.orders o
     WHERE o.payment_status = 'paid'
       AND o.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
  ),
  lines AS (
    SELECT oi.quantity, round(oi.unit_price * 100)::bigint AS unit_cents,
           round(p.cost_price * 100)::bigint AS cost_cents
      FROM public.order_items oi
      JOIN paid ON paid.id = oi.order_id
      LEFT JOIN public.products p ON p.id::text = oi.product_id::text
  )
  SELECT jsonb_build_object(
    'days', GREATEST(p_days, 1),
    'paid_orders', (SELECT count(*) FROM paid),
    'revenue_cents', COALESCE((SELECT sum(total_amount) FROM paid), 0),
    'avg_order_cents', COALESCE((SELECT round(avg(total_amount)) FROM paid), 0),
    'items_revenue_cents', COALESCE((SELECT sum(quantity * unit_cents) FROM lines WHERE cost_cents IS NOT NULL), 0),
    'items_cost_cents', COALESCE((SELECT sum(quantity * cost_cents) FROM lines WHERE cost_cents IS NOT NULL), 0),
    'lines_without_cost', (SELECT count(*) FROM lines WHERE cost_cents IS NULL),
    'fulfillment', COALESCE((
      SELECT jsonb_object_agg(fulfillment_status, n)
        FROM (SELECT fulfillment_status, count(*) AS n FROM paid GROUP BY 1) s
    ), '{}'::jsonb),
    'open_alerts', COALESCE((
      SELECT jsonb_object_agg(severity, n)
        FROM (SELECT severity, count(*) AS n FROM public.ops_alerts
               WHERE status IN ('open', 'acknowledged') GROUP BY 1) a
    ), '{}'::jsonb)
  );
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['oms_detect_alerts()', 'oms_dashboard_kpis(integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END;
$$;
REVOKE ALL ON public.oms_alert_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oms_alert_candidates TO service_role;

-- Make PostgREST pick up the new functions immediately.
NOTIFY pgrst, 'reload schema';
