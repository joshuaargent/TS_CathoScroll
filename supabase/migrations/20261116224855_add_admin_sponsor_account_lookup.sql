
CREATE OR REPLACE FUNCTION public.admin_find_sponsor_user_by_email(
  p_actor_user_id uuid, p_email text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_email IS NULL OR char_length(btrim(p_email)) NOT BETWEEN 3 AND 254
     OR btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid account email' USING ERRCODE = '22023';
  END IF;
  SELECT users.id INTO v_user_id
  FROM auth.users AS users
  WHERE lower(users.email) = lower(btrim(p_email))
  LIMIT 1;
  RETURN v_user_id;
END;
$function$;
ALTER FUNCTION public.admin_find_sponsor_user_by_email(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_find_sponsor_user_by_email(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_find_sponsor_user_by_email(uuid, text) TO service_role;
