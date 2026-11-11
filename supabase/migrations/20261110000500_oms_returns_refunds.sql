-- OMS Phase 5: returns, Stripe-backed refunds, customer-contact log.

ALTER TABLE public.order_notes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note'
  CHECK (kind IN ('note', 'customer_contact'));

CREATE TABLE IF NOT EXISTS public.order_returns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'refunded', 'closed')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  requested_amount_cents bigint CHECK (requested_amount_cents IS NULL OR requested_amount_cents >= 0),
  resolution_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_returns_order_idx ON public.order_returns (order_id);
CREATE INDEX IF NOT EXISTS order_returns_status_idx ON public.order_returns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  return_id bigint REFERENCES public.order_returns(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  stripe_refund_id text UNIQUE,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON public.order_refunds (order_id);

-- Reserve the money BEFORE calling Stripe, under a row lock, so two admins
-- clicking at once can never refund more than the order total. The row id is
-- also used as Stripe's idempotency key, so a retry cannot refund twice.
CREATE OR REPLACE FUNCTION public.reserve_refund(
  p_order_id text, p_amount_cents bigint, p_return_id bigint, p_actor uuid, p_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total bigint;
  v_paid text;
  v_used bigint;
  v_id uuid;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  SELECT total_amount, payment_status INTO v_total, v_paid
    FROM public.orders WHERE id::text = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_paid <> 'paid' THEN RAISE EXCEPTION 'order_not_paid'; END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_used
    FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');
  IF v_used + p_amount_cents > v_total THEN RAISE EXCEPTION 'exceeds_refundable'; END IF;
  INSERT INTO public.order_refunds (order_id, return_id, amount_cents, created_by, created_by_email)
  VALUES (p_order_id, p_return_id, p_amount_cents, p_actor, p_email)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_refund(
  p_id uuid, p_status text, p_stripe_refund_id text, p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_return bigint;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE public.order_refunds
     SET status = p_status, stripe_refund_id = p_stripe_refund_id,
         error = left(p_error, 500), finished_at = now()
   WHERE id = p_id AND status = 'pending'
  RETURNING return_id INTO v_return;
  IF NOT FOUND THEN RETURN; END IF; -- already finished: idempotent
  IF p_status = 'succeeded' AND v_return IS NOT NULL THEN
    UPDATE public.order_returns SET status = 'refunded', updated_at = now()
     WHERE id = v_return AND status IN ('approved', 'received');
  END IF;
END;
$$;

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_returns, public.order_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_returns, public.order_refunds TO service_role;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['reserve_refund(text, bigint, bigint, uuid, text)', 'finish_refund(uuid, text, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
