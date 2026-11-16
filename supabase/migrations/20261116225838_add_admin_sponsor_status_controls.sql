
CREATE OR REPLACE FUNCTION public.admin_set_sponsor_status(
  p_actor_user_id uuid, p_sponsor_id uuid, p_status text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('draft', 'scheduled', 'active', 'paused', 'completed') THEN
    RAISE EXCEPTION 'Invalid sponsor status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sponsors SET status = p_status, updated_at = statement_timestamp()
  WHERE id = p_sponsor_id RETURNING * INTO v_sponsor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.status_changed', 'sponsor', v_sponsor.id::text,
    jsonb_build_object('sponsor_name', v_sponsor.sponsor_name, 'status', v_sponsor.status));
  RETURN jsonb_build_object('id', v_sponsor.id, 'sponsor_name', v_sponsor.sponsor_name,
    'status', v_sponsor.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_status(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_status(uuid, uuid, text) TO service_role;
