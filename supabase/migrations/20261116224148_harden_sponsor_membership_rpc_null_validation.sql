
CREATE OR REPLACE FUNCTION public.admin_add_sponsor_member(
  p_actor_user_id uuid, p_sponsor_id uuid, p_user_id uuid, p_role text DEFAULT 'owner'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_membership public.sponsor_memberships%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'analyst')
     OR p_sponsor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id)
     OR p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor membership details' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sponsor_memberships (sponsor_id, user_id, role, status, added_by)
  VALUES (p_sponsor_id, p_user_id, p_role, 'active', p_actor_user_id)
  ON CONFLICT (sponsor_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', added_by = EXCLUDED.added_by,
        updated_at = statement_timestamp()
  RETURNING * INTO v_membership;
  INSERT INTO catho_private.admin_action_audit (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.member_added', 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'user_id', p_user_id, 'role', p_role));
  RETURN jsonb_build_object('id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status);
END;
$function$;
ALTER FUNCTION public.admin_add_sponsor_member(uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_add_sponsor_member(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_sponsor_member(uuid, uuid, uuid, text) TO service_role;

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
  v_status := CASE p_action WHEN 'suspend' THEN 'suspended'
    WHEN 'reactivate' THEN 'active' ELSE 'revoked' END;
  UPDATE public.sponsor_memberships
  SET status = v_status, updated_at = statement_timestamp()
  WHERE id = p_membership_id RETURNING * INTO v_membership;
  INSERT INTO catho_private.admin_action_audit (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.member_' || p_action, 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', v_membership.sponsor_id, 'user_id', v_membership.user_id, 'role', v_membership.role));
  RETURN jsonb_build_object('id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) TO service_role;
