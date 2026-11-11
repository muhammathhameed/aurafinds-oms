-- Removes everything created by oms_test_orders.sql (and anything you logged against it).
DELETE FROM public.order_refunds WHERE order_id IN (SELECT id::text FROM public.orders WHERE stripe_session_id LIKE 'cs_test_oms_seed_%');
DELETE FROM public.order_returns WHERE order_id IN (SELECT id::text FROM public.orders WHERE stripe_session_id LIKE 'cs_test_oms_seed_%');
DELETE FROM public.order_notes   WHERE order_id IN (SELECT id::text FROM public.orders WHERE stripe_session_id LIKE 'cs_test_oms_seed_%');
DELETE FROM public.order_items   WHERE order_id IN (SELECT id FROM public.orders WHERE stripe_session_id LIKE 'cs_test_oms_seed_%');
DELETE FROM public.orders        WHERE stripe_session_id LIKE 'cs_test_oms_seed_%';
-- Alerts about the deleted orders resolve themselves on the next "Run checks now".
