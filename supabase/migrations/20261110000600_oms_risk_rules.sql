-- OMS Phase 6: more proactive detection rules. Every rule is plain SQL over
-- data we already have; nothing here is a model or a guess.

CREATE TABLE IF NOT EXISTS public.product_image_checks (
  product_id text PRIMARY KEY,
  image_url text NOT NULL,
  ok boolean NOT NULL,
  http_status integer,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_image_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_image_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_image_checks TO service_role;

CREATE OR REPLACE VIEW public.oms_risk_candidates AS
  -- Order risk: same customer, same total, two paid orders within 24 hours.
  SELECT 'order.possible_duplicate'::text AS kind, 'medium'::text AS severity,
         'order'::text AS entity_type, b.id::text AS entity_id,
         'Possible duplicate order'::text AS title,
         jsonb_build_object('email', b.customer_email, 'other_order', a.id::text, 'total_cents', b.total_amount) AS detail,
         'order.possible_duplicate:' || b.id::text AS dedupe_key
    FROM public.orders a
    JOIN public.orders b
      ON a.customer_email = b.customer_email AND a.total_amount = b.total_amount AND a.id < b.id
     AND abs(extract(epoch FROM b.created_at - a.created_at)) < 86400
   WHERE a.payment_status = 'paid' AND b.payment_status = 'paid'
     AND a.customer_email IS NOT NULL AND b.created_at >= now() - interval '7 days'
  UNION ALL
  -- Product risks
  SELECT 'product.duplicate_sku', 'medium', 'product', p.id::text,
         'SKU is used by more than one product',
         jsonb_build_object('sku', p.sku), 'product.duplicate_sku:' || p.id::text
    FROM public.products p
   WHERE p.sku IS NOT NULL AND btrim(p.sku) <> ''
     AND (SELECT count(*) FROM public.products q WHERE q.sku = p.sku) > 1
  UNION ALL
  SELECT 'product.invalid_data', 'high', 'product', p.id::text,
         'Active product has an empty name or a non-positive price',
         jsonb_build_object('name', p.name, 'price', p.price), 'product.invalid_data:' || p.id::text
    FROM public.products p
   WHERE p.status = 'active' AND (p.name IS NULL OR btrim(p.name) = '' OR p.price IS NULL OR p.price <= 0)
  UNION ALL
  SELECT 'product.missing_description', 'low', 'product', p.id::text,
         'Active product has no description', jsonb_build_object('name', p.name),
         'product.missing_description:' || p.id::text
    FROM public.products p
   WHERE p.status = 'active'
     AND COALESCE(btrim(p.description), '') = '' AND COALESCE(btrim(p.short_description), '') = ''
  UNION ALL
  SELECT 'product.low_stock', CASE WHEN p.stock_quantity <= 0 THEN 'high' ELSE 'medium' END,
         'product', p.id::text,
         CASE WHEN p.stock_quantity <= 0 THEN 'Active product is out of stock' ELSE 'Active product is low on stock' END,
         jsonb_build_object('name', p.name, 'stock', p.stock_quantity), 'product.low_stock:' || p.id::text
    FROM public.products p
   WHERE p.status = 'active' AND p.stock_quantity IS NOT NULL AND p.stock_quantity <= 5
  UNION ALL
  SELECT 'product.broken_image', 'medium', 'product', c.product_id,
         'Product image URL is not loading',
         jsonb_build_object('url', c.image_url, 'http_status', c.http_status), 'product.broken_image:' || c.product_id
    FROM public.product_image_checks c
    JOIN public.products p ON p.id::text = c.product_id AND p.image_url = c.image_url
   WHERE NOT c.ok AND p.status = 'active' AND c.checked_at > now() - interval '7 days'
  UNION ALL
  -- Customer risks
  SELECT 'customer.high_refund_risk', 'medium', 'customer', e.email,
         'Customer with repeated return requests (90 days)',
         jsonb_build_object('returns', e.n), 'customer.high_refund_risk:' || e.email
    FROM (SELECT o.customer_email AS email, count(*) AS n
            FROM public.order_returns r JOIN public.orders o ON o.id::text = r.order_id
           WHERE r.created_at > now() - interval '90 days' AND o.customer_email IS NOT NULL
           GROUP BY 1 HAVING count(*) >= 2) e
  UNION ALL
  SELECT 'customer.repeat_complaints', 'medium', 'customer', e.email,
         'Customer contacted us 3+ times in 30 days',
         jsonb_build_object('contacts', e.n), 'customer.repeat_complaints:' || e.email
    FROM (SELECT o.customer_email AS email, count(*) AS n
            FROM public.order_notes nn JOIN public.orders o ON o.id::text = nn.order_id
           WHERE nn.kind = 'customer_contact' AND nn.created_at > now() - interval '30 days'
             AND o.customer_email IS NOT NULL
           GROUP BY 1 HAVING count(*) >= 3) e
  UNION ALL
  SELECT 'customer.vip_issue', 'high', 'customer', v.email,
         'High-value customer has an order in trouble',
         jsonb_build_object('orders', v.orders, 'spend_cents', v.spend), 'customer.vip_issue:' || v.email
    FROM (SELECT customer_email AS email, count(*) AS orders, sum(total_amount) AS spend
            FROM public.orders WHERE payment_status = 'paid' AND customer_email IS NOT NULL
           GROUP BY 1 HAVING count(*) >= 3 OR sum(total_amount) >= 30000) v
   WHERE EXISTS (
     SELECT 1 FROM public.orders o2
      WHERE o2.customer_email = v.email AND o2.payment_status = 'paid'
        AND (o2.fulfillment_status = 'failed'
             OR (o2.fulfillment_status IN ('pending', 'submitting') AND o2.created_at < now() - interval '30 minutes')))
  UNION ALL
  -- Supplier risks (CJ is the only supplier today)
  SELECT 'supplier.high_returns', 'high', 'supplier', 'cj',
         'CJ return rate is 15% or more (90 days)',
         jsonb_build_object('returns', s.returns, 'orders', s.orders), 'supplier.high_returns:cj'
    FROM (SELECT (SELECT count(*) FROM public.orders WHERE payment_status = 'paid' AND created_at > now() - interval '90 days') AS orders,
                 (SELECT count(*) FROM public.order_returns WHERE created_at > now() - interval '90 days' AND status <> 'rejected') AS returns) s
   WHERE s.orders >= 10 AND s.returns::numeric / s.orders >= 0.15
  UNION ALL
  SELECT 'supplier.slow_shipping', 'medium', 'supplier', 'cj',
         'CJ average time from submission to shipment is over 14 days',
         jsonb_build_object('avg_days', s.d, 'shipped', s.n), 'supplier.slow_shipping:cj'
    FROM (SELECT round((avg(extract(epoch FROM shipped_at - fulfillment_submitted_at)) / 86400)::numeric, 1) AS d, count(*) AS n
            FROM public.orders
           WHERE shipped_at IS NOT NULL AND fulfillment_submitted_at IS NOT NULL
             AND created_at > now() - interval '90 days') s
   WHERE s.n >= 5 AND s.d > 14
  UNION ALL
  SELECT 'supplier.failing', 'critical', 'supplier', 'cj',
         'Many CJ submissions failed in the last 24 hours (possible outage or low balance)',
         jsonb_build_object('failed', s.failed, 'orders', s.total), 'supplier.failing:cj'
    FROM (SELECT count(*) FILTER (WHERE fulfillment_status = 'failed') AS failed, count(*) AS total
            FROM public.orders WHERE payment_status = 'paid' AND created_at > now() - interval '24 hours') s
   WHERE s.failed >= 3 AND s.failed::numeric / s.total >= 0.3;

-- Combine with the Phase 2/4 rules without restating them (idempotent).
DO $$
BEGIN
  IF to_regclass('public.oms_alert_candidates_base') IS NULL THEN
    ALTER VIEW public.oms_alert_candidates RENAME TO oms_alert_candidates_base;
  END IF;
END;
$$;
CREATE OR REPLACE VIEW public.oms_alert_candidates AS
  SELECT * FROM public.oms_alert_candidates_base
  UNION ALL
  SELECT * FROM public.oms_risk_candidates;

REVOKE ALL ON public.oms_alert_candidates_base, public.oms_risk_candidates, public.oms_alert_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oms_alert_candidates_base, public.oms_risk_candidates, public.oms_alert_candidates TO service_role;

NOTIFY pgrst, 'reload schema';
