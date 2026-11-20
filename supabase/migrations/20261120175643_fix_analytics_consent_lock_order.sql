-- Correct analytics-consent row locking to match analytics writers.
-- Feed/sponsor writers lock consent rows before their event inserts acquire
-- foreign-key key-share locks on auth.users. Consent updates must use the same
-- order to avoid a consent-row/auth.users deadlock during withdrawal.

CREATE OR REPLACE FUNCTION public.set_user_analytics_consent(
  p_user_id uuid,
  p_service_improvement boolean,
  p_sponsor_measurement boolean,
  p_consent_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_previous_service boolean;
  v_previous_sponsor boolean;
  v_consent catho_private.user_analytics_consents%ROWTYPE;
  v_now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_service_improvement IS NULL OR p_sponsor_measurement IS NULL
     OR p_consent_version IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid analytics consent update' USING ERRCODE = '22023';
  END IF;
  -- Match analytics writers' lock order: consent row first, then auth.users.
  SELECT service_improvement, sponsor_measurement
  INTO v_previous_service, v_previous_sponsor
  FROM catho_private.user_analytics_consents
  WHERE user_id = p_user_id
  FOR UPDATE;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR UPDATE;

  IF v_previous_service IS NOT NULL
     AND v_previous_service = p_service_improvement
     AND v_previous_sponsor = p_sponsor_measurement THEN
    RETURN public.get_user_analytics_consent(p_user_id);
  END IF;

  INSERT INTO catho_private.user_analytics_consents (
    user_id, service_improvement, sponsor_measurement, consent_version,
    service_improvement_updated_at, sponsor_measurement_updated_at, created_at, updated_at
  ) VALUES (
    p_user_id, p_service_improvement, p_sponsor_measurement, p_consent_version,
    v_now, v_now, v_now, v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    service_improvement = EXCLUDED.service_improvement,
    sponsor_measurement = EXCLUDED.sponsor_measurement,
    consent_version = EXCLUDED.consent_version,
    service_improvement_updated_at = CASE
      WHEN catho_private.user_analytics_consents.service_improvement IS DISTINCT FROM EXCLUDED.service_improvement
      THEN v_now ELSE catho_private.user_analytics_consents.service_improvement_updated_at END,
    sponsor_measurement_updated_at = CASE
      WHEN catho_private.user_analytics_consents.sponsor_measurement IS DISTINCT FROM EXCLUDED.sponsor_measurement
      THEN v_now ELSE catho_private.user_analytics_consents.sponsor_measurement_updated_at END,
    updated_at = v_now
  RETURNING * INTO v_consent;

  INSERT INTO catho_private.user_analytics_consent_history (
    user_id, previous_service_improvement, previous_sponsor_measurement,
    service_improvement, sponsor_measurement, consent_version, recorded_at
  ) VALUES (
    p_user_id, v_previous_service, v_previous_sponsor,
    p_service_improvement, p_sponsor_measurement, p_consent_version, v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true
  );
END;
$function$;
ALTER FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
