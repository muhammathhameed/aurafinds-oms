-- Two candidate rows can share a dedupe_key (e.g. one order that duplicates two
-- earlier orders), which made INSERT .. ON CONFLICT fail for the whole scan.
-- Collapse them to one row per key.
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
    SELECT DISTINCT ON (dedupe_key) kind, severity, entity_type, entity_id, title, detail, dedupe_key
      FROM public.oms_alert_candidates
     ORDER BY dedupe_key
    ON CONFLICT (dedupe_key) WHERE status IN ('open', 'acknowledged')
    DO UPDATE SET last_seen = now(), severity = EXCLUDED.severity, detail = EXCLUDED.detail
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted) INTO v_opened FROM ins;

  WITH res AS (
    UPDATE public.ops_alerts a
       SET status = 'resolved', resolved_at = now()
     WHERE a.status IN ('open', 'acknowledged')
       AND NOT EXISTS (SELECT 1 FROM public.oms_alert_candidates c WHERE c.dedupe_key = a.dedupe_key)
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM res;

  RETURN jsonb_build_object('opened', v_opened, 'resolved', v_resolved);
END;
$$;
REVOKE ALL ON FUNCTION public.oms_detect_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oms_detect_alerts() TO service_role;
