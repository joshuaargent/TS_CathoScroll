
CREATE TABLE public.sponsor_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'analyst')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_memberships_sponsor_user_key UNIQUE (sponsor_id, user_id)
);
CREATE INDEX sponsor_memberships_user_status_idx
  ON public.sponsor_memberships (user_id, status, sponsor_id);
CREATE INDEX sponsor_memberships_sponsor_status_idx
  ON public.sponsor_memberships (sponsor_id, status, role);
ALTER TABLE public.sponsor_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sponsor_memberships FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sponsor_memberships TO service_role;

CREATE TABLE catho_private.sponsor_member_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.sponsor_campaigns(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX sponsor_member_audit_sponsor_created_idx
  ON catho_private.sponsor_member_audit (sponsor_id, created_at DESC);
ALTER TABLE catho_private.sponsor_member_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_member_audit FROM PUBLIC, anon, authenticated, service_role;

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
  IF p_role NOT IN ('owner', 'manager', 'analyst')
     OR NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor membership details' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sponsor_memberships (sponsor_id, user_id, role, status, added_by)
  VALUES (p_sponsor_id, p_user_id, p_role, 'active', p_actor_user_id)
  ON CONFLICT (sponsor_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', added_by = EXCLUDED.added_by,
        updated_at = statement_timestamp()
  RETURNING * INTO v_membership;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (
    p_actor_user_id, 'sponsor.member_added', 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'user_id', p_user_id, 'role', p_role)
  );
  RETURN jsonb_build_object(
    'id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status
  );
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
  IF p_action NOT IN ('suspend', 'reactivate', 'revoke') THEN
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

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (
    p_actor_user_id, 'sponsor.member_' || p_action, 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', v_membership.sponsor_id,
      'user_id', v_membership.user_id, 'role', v_membership.role)
  );
  RETURN jsonb_build_object(
    'id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status
  );
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_create_campaign(
  p_actor_user_id uuid, p_sponsor_id uuid, p_campaign_name text, p_headline text, p_body text,
  p_image_url text, p_destination_url text, p_cta_label text, p_starts_on date, p_ends_on date,
  p_target_category_slugs text[], p_target_topic_ids text[], p_placement_weight integer,
  p_frequency_cap_per_user_24h integer, p_frequency_cap_per_user_total integer,
  p_daily_impression_cap bigint, p_total_impression_cap bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_campaign public.sponsor_campaigns%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id AND membership.user_id = p_actor_user_id
      AND membership.status = 'active' AND membership.role IN ('owner', 'manager')
  ) THEN RAISE EXCEPTION 'Sponsor campaign management access required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(btrim(coalesce(p_campaign_name, ''))) NOT BETWEEN 2 AND 120
     OR char_length(btrim(coalesce(p_headline, ''))) NOT BETWEEN 2 AND 100
     OR char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 2 AND 500
     OR p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on
     OR p_destination_url IS NULL OR p_destination_url !~ '^https://'
     OR (p_image_url IS NOT NULL AND p_image_url !~ '^https://')
     OR p_target_category_slugs IS NULL OR cardinality(p_target_category_slugs) > 100
     OR p_target_topic_ids IS NULL OR cardinality(p_target_topic_ids) > 500
     OR p_placement_weight NOT BETWEEN 1 AND 1000
     OR p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 5
     OR p_frequency_cap_per_user_total NOT BETWEEN 1 AND 50
     OR (p_daily_impression_cap IS NOT NULL AND p_daily_impression_cap NOT BETWEEN 1 AND 1000000000)
     OR (p_total_impression_cap IS NOT NULL AND p_total_impression_cap NOT BETWEEN 1 AND 100000000000) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign configuration' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_target_category_slugs) AS target(slug)
    WHERE NOT EXISTS (SELECT 1 FROM public.categories AS category WHERE category.slug = target.slug)
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_target_topic_ids) AS target(topic_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.topics AS topic WHERE topic.id = target.topic_id)
  ) THEN RAISE EXCEPTION 'Unknown campaign targeting value' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.sponsor_campaigns (
    sponsor_id, campaign_name, headline, body, image_url, destination_url, cta_label,
    starts_on, ends_on, target_category_slugs, target_topic_ids, placement_weight,
    frequency_cap_per_user_24h, frequency_cap_per_user_total,
    daily_impression_cap, total_impression_cap, status, created_by
  ) VALUES (
    p_sponsor_id, btrim(p_campaign_name), btrim(p_headline), btrim(p_body),
    nullif(btrim(p_image_url), ''), btrim(p_destination_url),
    coalesce(nullif(btrim(p_cta_label), ''), 'Learn more'),
    p_starts_on, p_ends_on, p_target_category_slugs, p_target_topic_ids,
    p_placement_weight, p_frequency_cap_per_user_24h, p_frequency_cap_per_user_total,
    p_daily_impression_cap, p_total_impression_cap, 'pending_approval', p_actor_user_id
  ) RETURNING * INTO v_campaign;

  INSERT INTO catho_private.sponsor_member_audit
    (sponsor_id, actor_user_id, campaign_id, action, details)
  VALUES (p_sponsor_id, p_actor_user_id, v_campaign.id, 'campaign.submitted',
    jsonb_build_object('status', v_campaign.status, 'campaign_name', v_campaign.campaign_name));
  RETURN jsonb_build_object('id', v_campaign.id, 'campaign_name', v_campaign.campaign_name,
    'status', v_campaign.status, 'created_at', v_campaign.created_at);
END;
$function$;
ALTER FUNCTION public.sponsor_create_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sponsor_create_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_create_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.sponsor_update_campaign(
  p_actor_user_id uuid, p_campaign_id uuid, p_campaign_name text, p_headline text, p_body text,
  p_image_url text, p_destination_url text, p_cta_label text, p_starts_on date, p_ends_on date,
  p_target_category_slugs text[], p_target_topic_ids text[], p_placement_weight integer,
  p_frequency_cap_per_user_24h integer, p_frequency_cap_per_user_total integer,
  p_daily_impression_cap bigint, p_total_impression_cap bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_campaign public.sponsor_campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_campaign FROM public.sponsor_campaigns
  WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = v_campaign.sponsor_id AND membership.user_id = p_actor_user_id
      AND membership.status = 'active' AND membership.role IN ('owner', 'manager')
  ) THEN RAISE EXCEPTION 'Sponsor campaign management access required' USING ERRCODE = '42501'; END IF;
  IF v_campaign.status NOT IN ('draft', 'pending_approval', 'rejected') THEN
    RAISE EXCEPTION 'Approved or paused campaigns cannot be edited by sponsor accounts' USING ERRCODE = '23514';
  END IF;
  IF char_length(btrim(coalesce(p_campaign_name, ''))) NOT BETWEEN 2 AND 120
     OR char_length(btrim(coalesce(p_headline, ''))) NOT BETWEEN 2 AND 100
     OR char_length(btrim(coalesce(p_body, ''))) NOT BETWEEN 2 AND 500
     OR p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on
     OR p_destination_url IS NULL OR p_destination_url !~ '^https://'
     OR (p_image_url IS NOT NULL AND p_image_url !~ '^https://')
     OR p_target_category_slugs IS NULL OR cardinality(p_target_category_slugs) > 100
     OR p_target_topic_ids IS NULL OR cardinality(p_target_topic_ids) > 500
     OR p_placement_weight NOT BETWEEN 1 AND 1000
     OR p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 5
     OR p_frequency_cap_per_user_total NOT BETWEEN 1 AND 50
     OR (p_daily_impression_cap IS NOT NULL AND p_daily_impression_cap NOT BETWEEN 1 AND 1000000000)
     OR (p_total_impression_cap IS NOT NULL AND p_total_impression_cap NOT BETWEEN 1 AND 100000000000) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign configuration' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_target_category_slugs) AS target(slug)
    WHERE NOT EXISTS (SELECT 1 FROM public.categories AS category WHERE category.slug = target.slug)
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_target_topic_ids) AS target(topic_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.topics AS topic WHERE topic.id = target.topic_id)
  ) THEN RAISE EXCEPTION 'Unknown campaign targeting value' USING ERRCODE = '22023'; END IF;

  UPDATE public.sponsor_campaigns SET
    campaign_name = btrim(p_campaign_name), headline = btrim(p_headline), body = btrim(p_body),
    image_url = nullif(btrim(p_image_url), ''), destination_url = btrim(p_destination_url),
    cta_label = coalesce(nullif(btrim(p_cta_label), ''), 'Learn more'),
    starts_on = p_starts_on, ends_on = p_ends_on,
    target_category_slugs = p_target_category_slugs, target_topic_ids = p_target_topic_ids,
    placement_weight = p_placement_weight,
    frequency_cap_per_user_24h = p_frequency_cap_per_user_24h,
    frequency_cap_per_user_total = p_frequency_cap_per_user_total,
    daily_impression_cap = p_daily_impression_cap, total_impression_cap = p_total_impression_cap,
    status = CASE WHEN status = 'rejected' THEN 'pending_approval' ELSE status END,
    updated_at = statement_timestamp()
  WHERE id = p_campaign_id RETURNING * INTO v_campaign;

  INSERT INTO catho_private.sponsor_member_audit
    (sponsor_id, actor_user_id, campaign_id, action, details)
  VALUES (v_campaign.sponsor_id, p_actor_user_id, v_campaign.id, 'campaign.updated',
    jsonb_build_object('status', v_campaign.status, 'campaign_name', v_campaign.campaign_name));
  RETURN jsonb_build_object('id', v_campaign.id, 'campaign_name', v_campaign.campaign_name,
    'status', v_campaign.status, 'updated_at', v_campaign.updated_at);
END;
$function$;
ALTER FUNCTION public.sponsor_update_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sponsor_update_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_update_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(
  p_actor_user_id uuid, p_sponsor_id uuid,
  p_from date DEFAULT (timezone('UTC', statement_timestamp()))::date - 29,
  p_to date DEFAULT (timezone('UTC', statement_timestamp()))::date
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id AND membership.user_id = p_actor_user_id
      AND membership.status = 'active'
  ) THEN RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'campaigns', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', metrics.campaign_id, 'campaign_name', metrics.campaign_name,
      'status', metrics.status, 'served', metrics.served,
      'viewable_impressions', metrics.viewable_impressions, 'clicks', metrics.clicks,
      'click_through_rate', CASE WHEN metrics.viewable_impressions > 0
        THEN round(metrics.clicks::numeric * 100 / metrics.viewable_impressions, 2) ELSE 0 END
    ) ORDER BY metrics.served DESC, metrics.campaign_name), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT campaign.id AS campaign_id, campaign.campaign_name, campaign.status,
      coalesce(sum(daily.served_count), 0) AS served,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.clicks), 0) AS clicks
    FROM public.sponsor_campaigns AS campaign
    LEFT JOIN catho_private.sponsor_campaign_daily AS daily
      ON daily.campaign_id = campaign.id AND daily.event_date BETWEEN p_from AND p_to
    WHERE campaign.sponsor_id = p_sponsor_id
    GROUP BY campaign.id
  ) AS metrics;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role;

NOTIFY pgrst, 'reload schema';
