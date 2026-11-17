-- Phase 1: add the logo-free RPC overload while the old app version remains live.
-- Keep the old 14-argument function and sponsors.logo_url temporarily so deployed
-- clients continue working during the application rollout.

CREATE OR REPLACE FUNCTION public.admin_create_sponsor(
  p_actor_user_id uuid, p_sponsor_name text, p_contact_email text, p_website_url text,
  p_description text, p_starts_on date, p_ends_on date, p_status text,
  p_agreed_amount_minor bigint, p_currency text, p_payment_status text,
  p_payment_reference text, p_admin_notes text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_payment_status IS NULL OR p_payment_status NOT IN ('pending', 'not_required')
     OR (p_payment_status = 'not_required' AND coalesce(p_agreed_amount_minor, 0) > 0)
     OR (p_agreed_amount_minor IS NOT NULL AND p_agreed_amount_minor < 0)
     OR p_currency IS NULL OR p_currency NOT IN ('GBP', 'EUR', 'USD') THEN
    RAISE EXCEPTION 'A sponsor with an agreed fee must use pending payment and invoice reconciliation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sponsors (
    sponsor_name, contact_email, website_url, description, starts_on, ends_on,
    status, agreed_amount_minor, currency, payment_status, payment_received_at,
    payment_reference, admin_notes, created_by
  ) VALUES (
    btrim(p_sponsor_name), nullif(btrim(p_contact_email), ''), nullif(btrim(p_website_url), ''),
    coalesce(p_description, ''), p_starts_on, p_ends_on,
    p_status, p_agreed_amount_minor, p_currency, p_payment_status, NULL,
    NULL, coalesce(p_admin_notes, ''), p_actor_user_id
  ) RETURNING * INTO v_sponsor;
  INSERT INTO catho_private.admin_action_audit (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.created', 'sponsor', v_sponsor.id::text,
    jsonb_build_object('sponsor_name', v_sponsor.sponsor_name, 'status', v_sponsor.status,
      'payment_status', v_sponsor.payment_status, 'currency', v_sponsor.currency,
      'agreed_amount_minor', v_sponsor.agreed_amount_minor));
  RETURN jsonb_build_object('id', v_sponsor.id, 'sponsor_name', v_sponsor.sponsor_name,
    'status', v_sponsor.status, 'payment_status', v_sponsor.payment_status,
    'created_at', v_sponsor.created_at);
END;
$function$;
ALTER FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
