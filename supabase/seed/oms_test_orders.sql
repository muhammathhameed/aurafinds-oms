-- TEST DATA for trying out the OMS. Safe to run more than once.
-- Everything is marked: emails oms-test+...@example.com and Stripe session ids
-- cs_test_oms_seed_*. Remove it all with oms_test_orders_cleanup.sql.
-- Uses your existing active products (needs at least one). Fake Stripe session
-- ids mean REFUNDS on these orders will fail by design: to test a real refund,
-- place a test-mode checkout in the storefront.
DO $$
DECLARE
  s record;
  v_order uuid;
  v_product record;
  v_n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE status = 'active') THEN
    RAISE EXCEPTION 'No active products found; add one first.';
  END IF;

  FOR s IN SELECT * FROM (VALUES
    -- key, email, total_cents, payment, fulfillment, error, hours_ago, submitted_hours_ago, shipped_hours_ago, tracking, note
    (1, 'oms-test+vip@example.com',  8900, 'paid',   'shipped',    NULL,                                  72,  70, 24,  'TESTTRK0001', 'Shipped, with tracking'),
    (2, 'oms-test+vip@example.com',  6400, 'paid',   'processing', NULL,                                  26,  24, NULL, NULL,        'With CJ, no tracking yet'),
    (3, 'oms-test+vip@example.com', 15900, 'paid',   'failed',     'Insufficient CJ balance (test data)',  5,   NULL, NULL, NULL,       'Failed: raises failed + VIP alerts'),
    (4, 'oms-test+stuck@example.com', 4200, 'paid',  'pending',    NULL,                                  3,   NULL, NULL, NULL,        'Paid but never submitted: stuck alert'),
    (5, 'oms-test+slow@example.com', 5300, 'paid',   'processing', NULL,                                  200, 170, NULL, NULL,        'No tracking after 7 days: tracking alert'),
    (6, 'oms-test+dup@example.com',  3100, 'paid',   'shipped',    NULL,                                  30,  29, 5,   'TESTTRK0006', 'Duplicate pair, first'),
    (7, 'oms-test+dup@example.com',  3100, 'paid',   'pending',    NULL,                                  28,  NULL, NULL, NULL,        'Duplicate pair, second: possible-duplicate alert'),
    (8, 'oms-test+unpaid@example.com', 2000, 'unpaid', 'pending',  NULL,                                  9,   NULL, NULL, NULL,        'Unpaid: must be ignored by alerts and KPIs')
  ) AS t(k, email, total, pay, ful, err, h_ago, sub_ago, ship_ago, trk, note)
  LOOP
    IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_session_id = 'cs_test_oms_seed_' || s.k) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.orders (
      stripe_session_id, customer_email, total_amount, payment_status, currency,
      fulfillment_status, fulfillment_error, fulfillment_submitted_at, shipped_at,
      tracking_number, tracking_carrier, created_at, shipping_details
    ) VALUES (
      'cs_test_oms_seed_' || s.k, s.email, s.total, s.pay, 'usd',
      s.ful, s.err,
      CASE WHEN s.sub_ago IS NULL THEN NULL ELSE now() - make_interval(hours => s.sub_ago) END,
      CASE WHEN s.ship_ago IS NULL THEN NULL ELSE now() - make_interval(hours => s.ship_ago) END,
      s.trk, CASE WHEN s.trk IS NULL THEN NULL ELSE 'TEST-CARRIER' END,
      now() - make_interval(hours => s.h_ago),
      jsonb_build_object('name', 'Test Customer ' || s.k, 'note', s.note,
        'address', jsonb_build_object('line1', '1 Test Street', 'city', 'Testville', 'postal_code', '00000', 'country', 'US'))
    ) RETURNING id INTO v_order;

    SELECT id, price INTO v_product FROM public.products WHERE status = 'active' ORDER BY id OFFSET (s.k - 1) % GREATEST((SELECT count(*) FROM public.products WHERE status = 'active'), 1) LIMIT 1;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order, v_product.id, 1, round(s.total / 100.0, 2));
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Inserted % test order(s).', v_n;
END;
$$;

-- Then, in the OMS: Alerts -> Run checks now.
