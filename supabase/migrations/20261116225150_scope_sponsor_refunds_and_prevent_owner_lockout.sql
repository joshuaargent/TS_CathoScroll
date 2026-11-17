
CREATE OR REPLACE FUNCTION public.admin_set_sponsor_member_status(
  p_actor_user_id uuid, p_membership_id uuid, p_action text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_membership public.sponsor_memberships%ROWTYPE; v_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_membership_id IS NULL OR p_action IS NULL
     OR p_action NOT IN ('suspend', 'reactivate', 'revoke') THEN
    RAISE EXCEPTION 'Invalid membership action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_membership FROM public.sponsor_memberships
  WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor membership not found' USING ERRCODE = 'P0002'; END IF;
  IF v_membership.role = 'owner' AND p_action IN ('suspend', 'revoke')
     AND NOT EXISTS (
       SELECT 1 FROM public.sponsor_memberships AS other
       WHERE other.sponsor_id = v_membership.sponsor_id
         AND other.id <> v_membership.id AND other.role = 'owner' AND other.status = 'active'
     ) THEN
    RAISE EXCEPTION 'The last active sponsor owner cannot be suspended or revoked' USING ERRCODE = '23514';
  END IF;
  v_status := CASE p_action WHEN 'suspend' THEN 'suspended'
    WHEN 'reactivate' THEN 'active' ELSE 'revoked' END;
  UPDATE public.sponsor_memberships SET status = v_status, updated_at = statement_timestamp()
  WHERE id = p_membership_id RETURNING * INTO v_membership;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.member_' || p_action, 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', v_membership.sponsor_id,
      'user_id', v_membership.user_id, 'role', v_membership.role));
  RETURN jsonb_build_object('id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_record_sponsor_refund(
  p_actor_user_id uuid, p_sponsor_id uuid, p_payment_id uuid, p_amount_minor bigint,
  p_bank_reference text DEFAULT NULL, p_bank_transaction_date date DEFAULT NULL,
  p_bank_transaction_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_payment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_payment_transactions AS payment
    WHERE payment.id = p_payment_id AND payment.sponsor_id = p_sponsor_id
      AND payment.transaction_type = 'payment'
  ) THEN RAISE EXCEPTION 'Original payment not found for this sponsor' USING ERRCODE = 'P0002'; END IF;
  RETURN public.admin_record_sponsor_refund(
    p_actor_user_id, p_payment_id, p_amount_minor,
    p_bank_reference, p_bank_transaction_date, p_bank_transaction_key
  );
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
