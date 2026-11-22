-- CathoScroll account-only analytics consent and sponsor measurement upgrade.
-- No anonymous engagement analytics, sponsor delivery counts or served counters
-- are created or retained. Only explicit signed-in opt-ins produce measurements.

BEGIN;

CREATE TABLE IF NOT EXISTS catho_private.user_analytics_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  service_improvement boolean NOT NULL DEFAULT false,
  sponsor_measurement boolean NOT NULL DEFAULT false,
  consent_version integer NOT NULL DEFAULT 2 CHECK (consent_version >= 1),
  service_improvement_updated_at timestamptz,
  sponsor_measurement_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE IF NOT EXISTS catho_private.user_analytics_consent_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_service_improvement boolean,
  previous_sponsor_measurement boolean,
  service_improvement boolean NOT NULL,
  sponsor_measurement boolean NOT NULL,
  consent_version integer NOT NULL CHECK (consent_version >= 1),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX IF NOT EXISTS user_analytics_consent_history_user_recorded_idx
  ON catho_private.user_analytics_consent_history(user_id, recorded_at DESC);

ALTER TABLE catho_private.user_analytics_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.user_analytics_consent_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catho_private.user_analytics_consents, catho_private.user_analytics_consent_history
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_feed_analytics_events(p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'catho_private'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_event jsonb;
  v_event_id uuid;
  v_event_type text;
  v_entity_type text;
  v_entity_id text;
  v_session_id uuid;
  v_metadata jsonb;
  v_key text;
  v_value jsonb;
  v_inserted integer := 0;
  v_submitted integer;
  v_count integer;
  v_service_consent boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = v_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT consent.service_improvement INTO v_service_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = v_user_id
  FOR SHARE;
  IF coalesce(v_service_consent, false) IS NOT TRUE THEN RETURN 0; END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN RAISE EXCEPTION 'Events must be a JSON array' USING ERRCODE = '22023'; END IF;
  v_submitted := jsonb_array_length(p_events);
  IF v_submitted < 1 OR v_submitted > 50 OR octet_length(p_events::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid analytics batch size' USING ERRCODE = '22023';
  END IF;

  INSERT INTO catho_private.feed_analytics_event_limits AS limits
    (user_id, window_started_at, event_count)
  VALUES (v_user_id, statement_timestamp(), v_submitted)
  ON CONFLICT (user_id) DO UPDATE
    SET window_started_at = CASE
          WHEN limits.window_started_at <= statement_timestamp() - interval '1 minute' THEN statement_timestamp()
          ELSE limits.window_started_at END,
        event_count = CASE
          WHEN limits.window_started_at <= statement_timestamp() - interval '1 minute' THEN EXCLUDED.event_count
          ELSE limits.event_count + EXCLUDED.event_count END
  RETURNING event_count INTO v_count;
  IF v_count > 120 THEN RETURN -1; END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events)
  LOOP
    IF jsonb_typeof(v_event) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_event)) <> 6
       OR NOT (v_event ?& ARRAY['event_id','session_id','event_type','entity_type','entity_id','metadata']) THEN
      RAISE EXCEPTION 'Invalid analytics event shape' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_event_id := (v_event ->> 'event_id')::uuid;
      v_session_id := (v_event ->> 'session_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid analytics event identifier' USING ERRCODE = '22023';
    END;
    IF v_event_id IS NULL OR v_session_id IS NULL THEN
      RAISE EXCEPTION 'Analytics event identifiers are required' USING ERRCODE = '22023';
    END IF;

    v_event_type := v_event ->> 'event_type';
    v_entity_type := v_event ->> 'entity_type';
    v_entity_id := v_event ->> 'entity_id';
    v_metadata := v_event -> 'metadata';
    IF v_event_type IS NULL OR v_event_type NOT IN (
      'impression', 'viewable_impression', 'active_duration', 'skip', 'swipe_depth', 'completion', 'return_visit'
    ) OR v_entity_type IS NULL OR v_entity_type <> 'topic'
       OR v_entity_id IS NULL OR length(v_entity_id) NOT BETWEEN 1 AND 100
       OR v_metadata IS NULL OR jsonb_typeof(v_metadata) <> 'object'
       OR octet_length(v_metadata::text) > 1024 THEN
      RAISE EXCEPTION 'Invalid analytics event values' USING ERRCODE = '22023';
    END IF;

    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_metadata)
    LOOP
      IF v_key NOT IN ('slide_index', 'duration_ms', 'source', 'depth', 'completion_percent') THEN
        RAISE EXCEPTION 'Unsupported analytics metadata field' USING ERRCODE = '22023';
      END IF;
      IF v_key IN ('slide_index', 'duration_ms', 'depth', 'completion_percent')
         AND (jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^[0-9]+$') THEN
        RAISE EXCEPTION 'Invalid numeric analytics metadata' USING ERRCODE = '22023';
      END IF;
      IF v_key = 'duration_ms' AND (v_value #>> '{}')::numeric NOT BETWEEN 0 AND 60000 THEN
        RAISE EXCEPTION 'Invalid duration' USING ERRCODE = '22023';
      END IF;
      IF v_key = 'slide_index' AND (v_value #>> '{}')::numeric NOT BETWEEN 0 AND 20 THEN
        RAISE EXCEPTION 'Invalid slide index' USING ERRCODE = '22023';
      END IF;
      IF v_key = 'depth' AND (v_value #>> '{}')::numeric NOT BETWEEN 0 AND 20 THEN
        RAISE EXCEPTION 'Invalid swipe depth' USING ERRCODE = '22023';
      END IF;
      IF v_key = 'completion_percent' AND (v_value #>> '{}')::numeric NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'Invalid completion percentage' USING ERRCODE = '22023';
      END IF;
      IF v_key = 'source' AND (
        jsonb_typeof(v_value) <> 'string'
        OR v_value #>> '{}' NOT IN ('feed', 'topic', 'category', 'search', 'related', 'direct')
      ) THEN
        RAISE EXCEPTION 'Invalid analytics source' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = v_entity_id AND t.is_published = true) THEN
      RAISE EXCEPTION 'Analytics topic is unavailable' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catho_private.feed_analytics_events (
      user_id, event_id, event_type, entity_type, entity_id, session_id, metadata, received_at
    )
    VALUES (v_user_id, v_event_id, v_event_type, v_entity_type, v_entity_id, v_session_id, v_metadata, statement_timestamp())
    ON CONFLICT (user_id, event_id) DO NOTHING;
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$function$;
ALTER FUNCTION public.record_feed_analytics_events(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_feed_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_analytics_events(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_feed_card_analytics_events(p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_event jsonb;
  v_count integer := 0;
  v_event_id uuid;
  v_event_type text;
  v_card_type text;
  v_card_id text;
  v_session_id uuid;
  v_duration integer;
  v_window timestamptz;
  v_used integer;
  v_event_id_text text;
  v_session_id_text text;
  v_duration_text text;
  v_service_consent boolean := false;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  PERFORM 1 FROM auth.users AS account WHERE account.id = v_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  select consent.service_improvement into v_service_consent
  from catho_private.user_analytics_consents as consent
  where consent.user_id = v_user_id
  for share;
  if coalesce(v_service_consent, false) is not true then return 0; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 50 then
    raise exception 'invalid event batch' using errcode='22023';
  end if;
  insert into catho_private.feed_card_analytics_event_limits(user_id,window_started_at,event_count)
  values(v_user_id,statement_timestamp(),0) on conflict(user_id) do nothing;
  select window_started_at,event_count into v_window,v_used
  from catho_private.feed_card_analytics_event_limits where user_id=v_user_id for update;
  if v_window <= statement_timestamp()-interval '1 minute' then v_window:=statement_timestamp(); v_used:=0; end if;
  if v_used + jsonb_array_length(p_events) > 120 then return -1; end if;
  update catho_private.feed_card_analytics_event_limits
  set window_started_at=v_window,event_count=v_used+jsonb_array_length(p_events) where user_id=v_user_id;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_event)<>'object' or (select count(*) from jsonb_object_keys(v_event))>7 then
      raise exception 'invalid event' using errcode='22023';
    end if;
    v_event_id_text:=v_event->>'event_id';
    v_session_id_text:=v_event->>'session_id';
    v_duration_text:=coalesce(v_event->>'duration_ms','0');
    if v_event_id_text is null or v_event_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_session_id_text is null or v_session_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_duration_text !~ '^[0-9]{1,6}$' then
      raise exception 'invalid event identifiers or duration' using errcode='22023';
    end if;
    v_event_id:=v_event_id_text::uuid;
    v_session_id:=v_session_id_text::uuid;
    v_duration:=v_duration_text::integer;
    v_event_type:=v_event->>'event_type';
    v_card_type:=v_event->>'card_type';
    v_card_id:=v_event->>'card_id';
    if v_event_type is null or v_event_type not in ('impression','viewable_impression','active_duration','skip','completion','open')
      or v_card_type is null or v_card_type<>'top-comment'
      or v_card_id is null or length(v_card_id) not between 1 and 64
      or v_duration not between 0 and 300000
      or (v_event ? 'metadata' and jsonb_typeof(v_event->'metadata')<>'object')
      or octet_length(coalesce(v_event->'metadata','{}'::jsonb)::text)>512 then
      raise exception 'invalid event fields' using errcode='22023';
    end if;
    insert into catho_private.feed_card_analytics_events(user_id,event_id,event_type,card_type,card_id,session_id,duration_ms,metadata)
    values(v_user_id,v_event_id,v_event_type,v_card_type,v_card_id,v_session_id,v_duration,coalesce(v_event->'metadata','{}'::jsonb))
    on conflict(user_id,event_id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$function$;
ALTER FUNCTION public.record_feed_card_analytics_events(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_feed_card_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_card_analytics_events(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(p_user_id uuid, p_campaign_id uuid, p_event_id uuid, p_session_id uuid, p_event_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date;
  v_inserted integer := 0;
  v_sponsor_consent boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_event_type IS NULL OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;
  SELECT consent.sponsor_measurement INTO v_sponsor_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id
  FOR SHARE;
  IF coalesce(v_sponsor_consent, false) IS NOT TRUE THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS served
    WHERE served.user_id=p_user_id AND served.campaign_id=p_campaign_id
      AND served.session_id=p_session_id AND served.event_type='served'
      AND served.received_at >= pg_catalog.statement_timestamp() - interval '24 hours'
  ) THEN RAISE EXCEPTION 'Sponsor campaign was not served in this session' USING ERRCODE = '42501'; END IF;
  IF p_event_type='click' AND NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS viewed
    WHERE viewed.user_id=p_user_id AND viewed.campaign_id=p_campaign_id
      AND viewed.session_id=p_session_id AND viewed.event_type='viewable_impression'
  ) THEN RAISE EXCEPTION 'Sponsor campaign must be viewable before a click or active-duration event is recorded' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.user_id=p_user_id AND existing.campaign_id=p_campaign_id
      AND existing.session_id=p_session_id AND existing.event_type=p_event_type
  ) THEN RETURN true; END IF;

  INSERT INTO catho_private.sponsor_campaign_events
    (campaign_id,event_id,user_id,session_id,event_type,received_at)
  VALUES (p_campaign_id,p_event_id,p_user_id,p_session_id,p_event_type,pg_catalog.statement_timestamp())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 THEN
    RETURN EXISTS (
      SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
      WHERE existing.user_id=p_user_id AND existing.campaign_id=p_campaign_id
        AND existing.session_id=p_session_id AND existing.event_type=p_event_type
    );
  END IF;

  INSERT INTO catho_private.sponsor_campaign_daily
    (event_date,campaign_id,served_count,viewable_impressions,clicks,updated_at)
  VALUES (v_today,p_campaign_id,0,
    CASE WHEN p_event_type='viewable_impression' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type='click' THEN 1 ELSE 0 END,pg_catalog.statement_timestamp())
  ON CONFLICT (event_date,campaign_id) DO UPDATE
  SET viewable_impressions=catho_private.sponsor_campaign_daily.viewable_impressions+EXCLUDED.viewable_impressions,
      clicks=catho_private.sponsor_campaign_daily.clicks+EXCLUDED.clicks,
      updated_at=EXCLUDED.updated_at;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(p_user_id uuid, p_session_id uuid, p_category_slug text DEFAULT NULL::text, p_topic_id text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_slot integer;
  v_today date := (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_session_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign request' USING ERRCODE = '22023';
  END IF;
  IF p_topic_id IS NULL THEN RAISE EXCEPTION 'Sponsor placement topic is required' USING ERRCODE = '22023'; END IF;
  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(consent.sponsor_measurement, false)
  INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id
  FOR SHARE;
  v_session_id := CASE WHEN coalesce(v_sponsor_measurement, false) THEN p_session_id ELSE NULL END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 9173));

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, campaign.sponsor_id, sponsor.sponsor_name,
      campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    LEFT JOIN catho_private.sponsor_campaign_user_frequency AS frequency
      ON frequency.campaign_id = campaign.id AND frequency.user_id = p_user_id AND v_session_id IS NOT NULL
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0
        OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0
        OR (p_topic_id IS NOT NULL AND p_topic_id = ANY(campaign.target_topic_ids)))
      AND (campaign.daily_impression_cap IS NULL OR
        coalesce((SELECT daily.served_count FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today), 0)
        + coalesce((SELECT daily.served_count FROM catho_private.anonymous_sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today), 0)
        < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR campaign.served_count + coalesce((
        SELECT pg_catalog.sum(daily.served_count) FROM catho_private.anonymous_sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND CASE WHEN v_session_id IS NULL THEN true ELSE (
        coalesce(frequency.served_count, 0) < campaign.frequency_cap_per_user_total
        AND (SELECT pg_catalog.count(*) FROM catho_private.sponsor_campaign_events AS recent_viewable
          WHERE recent_viewable.user_id = p_user_id AND recent_viewable.campaign_id = campaign.id
            AND recent_viewable.event_type = 'viewable_impression'
            AND recent_viewable.received_at >= pg_catalog.statement_timestamp() - interval '24 hours')
          < campaign.frequency_cap_per_user_24h
      ) END
      AND NOT (campaign.id = ANY(v_campaign_ids))
    ORDER BY
      (coalesce((SELECT pg_catalog.sum(daily.viewable_impressions)::numeric
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0)
        + coalesce((SELECT pg_catalog.sum(daily.viewable_impressions)::numeric
          FROM catho_private.anonymous_sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0))
        / campaign.placement_weight::numeric ASC,
      pg_catalog.random(), campaign.id
    LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;

    IF NOT FOUND THEN EXIT; END IF;

    UPDATE public.sponsor_campaigns SET served_count=served_count+1, updated_at=pg_catalog.statement_timestamp()
    WHERE id=v_campaign.id;

    IF v_session_id IS NOT NULL THEN
      INSERT INTO catho_private.sponsor_campaign_events
        (campaign_id,event_id,user_id,session_id,event_type,received_at)
      VALUES (v_campaign.id,pg_catalog.gen_random_uuid(),p_user_id,v_session_id,'served',pg_catalog.statement_timestamp());

      INSERT INTO catho_private.sponsor_campaign_user_frequency
        (campaign_id,user_id,served_count,last_served_at)
      VALUES (v_campaign.id,p_user_id,1,pg_catalog.statement_timestamp())
      ON CONFLICT (campaign_id,user_id) DO UPDATE
      SET served_count=catho_private.sponsor_campaign_user_frequency.served_count+1,
        last_served_at=EXCLUDED.last_served_at;
    END IF;

    INSERT INTO catho_private.sponsor_campaign_daily
      (event_date,campaign_id,served_count,viewable_impressions,clicks,updated_at)
    VALUES (v_today,v_campaign.id,1,0,0,pg_catalog.statement_timestamp())
    ON CONFLICT (event_date,campaign_id) DO UPDATE
    SET served_count=catho_private.sponsor_campaign_daily.served_count+1,updated_at=EXCLUDED.updated_at;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids,v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id',v_campaign.id,'sponsor_name',v_campaign.sponsor_name,
      'sponsor_logo_url',NULL,
      'campaign_name',v_campaign.campaign_name,
      'headline',v_campaign.headline,'body',v_campaign.body,'image_url',v_campaign.image_url,
      'destination_url',v_campaign.destination_url,'cta_label',v_campaign.cta_label,
      'disclosure','Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns',v_campaigns,'generated_at',pg_catalog.statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

DROP FUNCTION IF EXISTS public.record_anonymous_sponsor_campaign_event(text,uuid,text,uuid,text);

CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(p_user_id uuid, p_session_id uuid, p_category_slug text DEFAULT NULL::text, p_topic_id text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_slot integer;
  v_today date := (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_session_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign request' USING ERRCODE = '22023';
  END IF;
  IF p_topic_id IS NULL THEN RAISE EXCEPTION 'Sponsor placement topic is required' USING ERRCODE = '22023'; END IF;
  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sponsor campaign request' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(consent.sponsor_measurement, false)
  INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id
  FOR SHARE;
  v_session_id := CASE WHEN coalesce(v_sponsor_measurement, false) THEN p_session_id ELSE NULL END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 9173));

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, campaign.sponsor_id, sponsor.sponsor_name,
      campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    LEFT JOIN catho_private.sponsor_campaign_user_frequency AS frequency
      ON frequency.campaign_id = campaign.id AND frequency.user_id = p_user_id AND v_session_id IS NOT NULL
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0
        OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0
        OR (p_topic_id IS NOT NULL AND p_topic_id = ANY(campaign.target_topic_ids)))
      AND (campaign.daily_impression_cap IS NULL OR
        coalesce((SELECT daily.served_count FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today), 0)
        + coalesce((SELECT daily.served_count FROM catho_private.anonymous_sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today), 0)
        < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR campaign.served_count + coalesce((
        SELECT pg_catalog.sum(daily.served_count) FROM catho_private.anonymous_sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND CASE WHEN v_session_id IS NULL THEN true ELSE (
        coalesce(frequency.served_count, 0) < campaign.frequency_cap_per_user_total
        AND (SELECT pg_catalog.count(*) FROM catho_private.sponsor_campaign_events AS recent_viewable
          WHERE recent_viewable.user_id = p_user_id AND recent_viewable.campaign_id = campaign.id
            AND recent_viewable.event_type = 'viewable_impression'
            AND recent_viewable.received_at >= pg_catalog.statement_timestamp() - interval '24 hours')
          < campaign.frequency_cap_per_user_24h
      ) END
      AND NOT (campaign.id = ANY(v_campaign_ids))
    ORDER BY
      (coalesce((SELECT pg_catalog.sum(daily.viewable_impressions)::numeric
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0)
        + coalesce((SELECT pg_catalog.sum(daily.viewable_impressions)::numeric
          FROM catho_private.anonymous_sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0))
        / campaign.placement_weight::numeric ASC,
      pg_catalog.random(), campaign.id
    LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;

    IF NOT FOUND THEN EXIT; END IF;

    UPDATE public.sponsor_campaigns SET served_count=served_count+1, updated_at=pg_catalog.statement_timestamp()
    WHERE id=v_campaign.id;

    IF v_session_id IS NOT NULL THEN
      INSERT INTO catho_private.sponsor_campaign_events
        (campaign_id,event_id,user_id,session_id,event_type,received_at)
      VALUES (v_campaign.id,pg_catalog.gen_random_uuid(),p_user_id,v_session_id,'served',pg_catalog.statement_timestamp());

      INSERT INTO catho_private.sponsor_campaign_user_frequency
        (campaign_id,user_id,served_count,last_served_at)
      VALUES (v_campaign.id,p_user_id,1,pg_catalog.statement_timestamp())
      ON CONFLICT (campaign_id,user_id) DO UPDATE
      SET served_count=catho_private.sponsor_campaign_user_frequency.served_count+1,
        last_served_at=EXCLUDED.last_served_at;
    END IF;

    INSERT INTO catho_private.sponsor_campaign_daily
      (event_date,campaign_id,served_count,viewable_impressions,clicks,updated_at)
    VALUES (v_today,v_campaign.id,1,0,0,pg_catalog.statement_timestamp())
    ON CONFLICT (event_date,campaign_id) DO UPDATE
    SET served_count=catho_private.sponsor_campaign_daily.served_count+1,updated_at=EXCLUDED.updated_at;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids,v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id',v_campaign.id,'sponsor_name',v_campaign.sponsor_name,
      'sponsor_logo_url',NULL,
      'campaign_name',v_campaign.campaign_name,
      'headline',v_campaign.headline,'body',v_campaign.body,'image_url',v_campaign.image_url,
      'destination_url',v_campaign.destination_url,'cta_label',v_campaign.cta_label,
      'disclosure','Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns',v_campaigns,'generated_at',pg_catalog.statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

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
     OR p_consent_version IS DISTINCT FROM 2
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid analytics consent update' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR UPDATE;

  SELECT service_improvement, sponsor_measurement
  INTO v_previous_service, v_previous_sponsor
  FROM catho_private.user_analytics_consents
  WHERE user_id = p_user_id
  FOR UPDATE;

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

  IF v_previous_service IS DISTINCT FROM p_service_improvement
     AND pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
  END IF;

  IF p_sponsor_measurement IS NOT TRUE THEN
    DELETE FROM catho_private.sponsor_campaign_placement_receipts
    WHERE user_id = p_user_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', EXISTS (
      SELECT 1 FROM catho_private.user_personalization_consents AS pc
      WHERE pc.user_id = p_user_id AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
    )
  );
END;
$function$;
ALTER FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;



-- Sponsor portal reports only account-consented viewability and clicks. Unmeasured delivery is not counted.
CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.sponsor_memberships AS m
    WHERE m.sponsor_id = p_sponsor_id
      AND m.user_id = p_actor_user_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH campaigns AS (
    SELECT c.id, c.campaign_name, c.status
    FROM public.sponsor_campaigns AS c
    WHERE c.sponsor_id = p_sponsor_id
  ),
  signed_in AS (
    SELECT
      d.campaign_id,
      sum(d.served_count) AS served,
      sum(d.viewable_impressions) AS viewable_impressions,
      sum(d.clicks) AS clicks
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date BETWEEN p_from AND p_to
    GROUP BY d.campaign_id
  ),
  signed_out AS (
    SELECT
      d.campaign_id,
      sum(d.served_count) AS served
    FROM catho_private.anonymous_sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date BETWEEN p_from AND p_to
    GROUP BY d.campaign_id
  ),
  metrics AS (
    SELECT
      c.id AS campaign_id,
      c.campaign_name,
      c.status,
      coalesce(si.served, 0) AS served,
      coalesce(si.viewable_impressions, 0) AS viewable_impressions,
      coalesce(si.clicks, 0) AS clicks,
      coalesce(so.served, 0) AS anonymous_served
    FROM campaigns AS c
    LEFT JOIN signed_in AS si ON si.campaign_id = c.id
    LEFT JOIN signed_out AS so ON so.campaign_id = c.id
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'campaign_id', m.campaign_id,
          'campaign_name', m.campaign_name,
          'status', m.status,
          'served', m.served,
          'viewable_impressions', m.viewable_impressions,
          'clicks', m.clicks,
          'anonymous_served', m.anonymous_served,
          'total_served', m.served + m.anonymous_served,
          'click_through_rate',
            CASE
              WHEN m.viewable_impressions > 0
                THEN round(m.clicks::numeric * 100 / m.viewable_impressions, 2)
              ELSE 0
            END
        )
        ORDER BY m.served + m.anonymous_served DESC, m.campaign_name
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM metrics AS m;

  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role;

NOTIFY pgrst, 'reload schema';


-- FINAL ANALYTICS MODEL: NO ANONYMOUS MEASUREMENT AND NO SPONSOR DELIVERY COUNTERS.
-- Sponsor selection is still available to every visitor. Selection itself is not recorded.
CREATE OR REPLACE FUNCTION public.get_unmeasured_sponsor_campaigns(
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_slot integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR (p_category_slug IS NOT NULL AND p_category_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
     OR p_topic_id IS NULL
     OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid sponsor request' USING ERRCODE = '22023';
  END IF;

  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic
  WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND OR (p_category_slug IS NOT NULL AND p_category_slug <> v_topic_category_slug) THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY -ln(greatest(pg_catalog.random(), 0.000000000001)) / campaign.placement_weight::numeric ASC, campaign.id
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(
  p_user_id uuid,
  p_session_id uuid,
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_slot integer;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor measurement request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT coalesce(consent.sponsor_measurement, false) INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF NOT coalesce(v_sponsor_measurement, false) THEN
    RAISE EXCEPTION 'Sponsor measurement consent required' USING ERRCODE = '42501';
  END IF;

  IF p_topic_id IS NULL OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Sponsor placement topic is required' USING ERRCODE = '22023';
  END IF;
  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND (campaign.daily_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today
      ), 0) < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS recent
        WHERE recent.user_id = p_user_id AND recent.campaign_id = campaign.id
          AND recent.event_type = 'viewable_impression'
          AND recent.received_at >= statement_timestamp() - interval '24 hours') < campaign.frequency_cap_per_user_24h
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS lifetime
        WHERE lifetime.user_id = p_user_id AND lifetime.campaign_id = campaign.id
          AND lifetime.event_type = 'viewable_impression') < campaign.frequency_cap_per_user_total
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY
      coalesce((SELECT sum(daily.viewable_impressions)::numeric
        FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
          AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0)
        / campaign.placement_weight::numeric ASC,
      pg_catalog.random(), campaign.id
    LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;

    IF NOT FOUND THEN EXIT; END IF;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'sponsor_logo_url', NULL,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_sponsor_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_sponsor_id IS NULL OR p_from IS NULL OR p_to IS NULL
     OR p_to <= p_from OR p_to - p_from > interval '180 days' THEN
    RAISE EXCEPTION 'Invalid sponsor analytics range' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;

  WITH campaigns AS (
    SELECT id, campaign_name, status
    FROM public.sponsor_campaigns WHERE sponsor_id = p_sponsor_id
  ),
  metrics AS (
    SELECT coalesce(sum(d.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(d.clicks), 0) AS clicks,
      coalesce(sum(d.active_duration_ms), 0) AS active_duration_ms,
      coalesce(sum(d.active_duration_ms), 0) AS active_duration_ms,
      count(DISTINCT d.campaign_id) FILTER (WHERE d.viewable_impressions > 0) AS active_campaigns
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date >= p_from::date AND d.event_date <= p_to::date
  ),
  series AS (
    SELECT d.event_date,
      coalesce(sum(d.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(d.clicks), 0) AS clicks,
      coalesce(sum(d.active_duration_ms), 0) AS active_duration_ms
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date >= p_from::date AND d.event_date <= p_to::date
    GROUP BY d.event_date ORDER BY d.event_date
  )
  SELECT jsonb_build_object(
    'sponsor_id', p_sponsor_id,
    'totals', (SELECT to_jsonb(metrics) FROM metrics),
    'campaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.campaign_name, 'status', c.status)), '[]'::jsonb) FROM campaigns AS c),
    'series', (SELECT coalesce(jsonb_agg(to_jsonb(series)), '[]'::jsonb) FROM series)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id
      AND membership.user_id = p_actor_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH campaigns AS (
    SELECT campaign.id, campaign.campaign_name, campaign.status
    FROM public.sponsor_campaigns AS campaign
    WHERE campaign.sponsor_id = p_sponsor_id
  ),
  metrics AS (
    SELECT campaign.id AS campaign_id, campaign.campaign_name, campaign.status,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.clicks), 0) AS clicks
    FROM campaigns AS campaign
    LEFT JOIN catho_private.sponsor_campaign_daily AS daily
      ON daily.campaign_id = campaign.id AND daily.event_date BETWEEN p_from AND p_to
    GROUP BY campaign.id, campaign.campaign_name, campaign.status
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', metrics.campaign_id,
      'campaign_name', metrics.campaign_name,
      'status', metrics.status,
      'viewable_impressions', metrics.viewable_impressions,
      'clicks', metrics.clicks,
      'click_through_rate', CASE WHEN metrics.viewable_impressions > 0
        THEN round(metrics.clicks::numeric * 100 / metrics.viewable_impressions, 2) ELSE 0 END
    ) ORDER BY metrics.viewable_impressions DESC, metrics.campaign_name), '[]'::jsonb)
  ) INTO v_result
  FROM metrics;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role;

-- Replace the public general-feed ranking before removing the legacy anonymous
-- aggregate table. The replacement uses public interactions and consented
-- signed-in feed aggregates only.
CREATE OR REPLACE FUNCTION public.get_public_general_topic_page(feed_cursor jsonb DEFAULT NULL::jsonb, page_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  state jsonb;
  categories jsonb;
  ranked_topics jsonb := '{}'::jsonb;
  chosen record;
  items jsonb := '[]'::jsonb;
  last_category text;
  streak integer;
  item_count integer := 0;
  initial_page boolean := feed_cursor IS NULL OR feed_cursor = 'null'::jsonb;
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 50 THEN
    RAISE EXCEPTION 'Invalid general-feed page size' USING ERRCODE = '22023';
  END IF;

  IF initial_page THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'served', 0, 'offset', 0) ORDER BY c.slug), '[]'::jsonb)
    INTO categories FROM public.categories c WHERE c.is_published;
    state := jsonb_build_object('categories', categories, 'last', NULL, 'streak', 0);
  ELSE
    state := feed_cursor;
  END IF;

  IF jsonb_typeof(state) IS DISTINCT FROM 'object'
     OR NOT (state ?& ARRAY['categories','last','streak'])
     OR octet_length(state::text) > 32768
     OR jsonb_typeof(state->'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(state->'categories') > 200
     OR jsonb_typeof(state->'streak') IS DISTINCT FROM 'number'
     OR coalesce(state->>'streak','') !~ '^[0-2]$'
     OR (state->'last' <> 'null'::jsonb AND (
       jsonb_typeof(state->'last') IS DISTINCT FROM 'string'
       OR state->>'last' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR length(state->>'last') > 100
     )) THEN
    RAISE EXCEPTION 'Invalid general-feed cursor' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(state->'categories') a(entry)
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR NOT (entry ?& ARRAY['slug','served','offset'])
      OR jsonb_typeof(entry->'slug') IS DISTINCT FROM 'string'
      OR entry->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      OR length(entry->>'slug') > 100
      OR jsonb_typeof(entry->'served') IS DISTINCT FROM 'number'
      OR coalesce(entry->>'served','') !~ '^[0-9]{1,9}$'
      OR jsonb_typeof(entry->'offset') IS DISTINCT FROM 'number'
      OR coalesce(entry->>'offset','') !~ '^[0-9]{1,9}$'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(state->'categories') a(entry)
    GROUP BY entry->>'slug' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid general-feed category cursor' USING ERRCODE = '22023';
  END IF;

  categories := state->'categories';
  last_category := state->>'last';
  streak := (state->>'streak')::integer;

  -- Compute each topic score once per requested page, not once per feed slot.
  SELECT coalesce(jsonb_object_agg(category_slug, topic_ids), '{}'::jsonb)
  INTO ranked_topics
  FROM (
    SELECT category_slug,
      jsonb_agg(topic_id ORDER BY rank_score DESC, order_index, topic_id) AS topic_ids
    FROM (
      SELECT t.id AS topic_id, t.category_slug, t.order_index,
        (
          coalesce((
            SELECT sum(
              d.viewable_impressions * exp(-greatest(0, current_date-d.event_date)::numeric / 45.0)
              + d.impressions * 0.12 * exp(-greatest(0, current_date-d.event_date)::numeric / 45.0)
              + d.completions * 2.0 * exp(-greatest(0, current_date-d.event_date)::numeric / 45.0)
              + least(d.active_duration_ms, 3600000)::numeric / 60000.0 * 0.18
                * exp(-greatest(0, current_date-d.event_date)::numeric / 45.0)
              - d.skips * 0.35 * exp(-greatest(0, current_date-d.event_date)::numeric / 45.0)
            )
            FROM (
              SELECT d.event_date,d.viewable_impressions,d.impressions,d.completions,d.active_duration_ms,d.skips,d.entity_id
              FROM catho_private.feed_analytics_daily d
            ) d
            WHERE d.entity_id=t.id AND d.event_date >= current_date-89
          ),0)
          + ln(1 + (SELECT count(*) FROM public.topic_likes l WHERE l.topic_id=t.id)) * 1.2
          + ln(1 + (SELECT count(*) FROM public.bookmarks b WHERE b.topic_id=t.id)) * 1.0
          + ln(1 + (SELECT count(*) FROM public.comments cm WHERE cm.topic_id=t.id
            AND cm.parent_id IS NULL AND cm.is_deleted=false)) * 0.8
          + 2.0 / sqrt(1 + coalesce((
            SELECT sum(d.viewable_impressions) FROM (
              SELECT d.event_date,d.viewable_impressions,d.impressions,d.completions,d.active_duration_ms,d.skips,d.entity_id
              FROM catho_private.feed_analytics_daily d
            ) d
            WHERE d.entity_id=t.id AND d.event_date >= current_date-89
          ),0))
        )::numeric AS rank_score
      FROM public.topics t
      JOIN public.categories c ON c.slug=t.category_slug AND c.is_published
      WHERE t.is_published
    ) scored
    GROUP BY category_slug
  ) grouped_topics;

  WHILE item_count < page_limit LOOP
    SELECT a.ordinality::integer - 1 AS position, a.entry,
      t.id, t.slug, t.order_index, t.question, t.answer, t.explanation,
      t.catechism_paragraphs, t.catechism_text, t.scripture_reference,
      t.scripture_text, c.name AS category_name, c.slug AS category_slug
    INTO chosen
    FROM jsonb_array_elements(categories) WITH ORDINALITY a(entry, ordinality)
    JOIN public.categories c ON c.slug=a.entry->>'slug' AND c.is_published
    CROSS JOIN LATERAL (
      SELECT topic.*
      FROM jsonb_array_elements_text(coalesce(ranked_topics->c.slug,'[]'::jsonb))
        WITH ORDINALITY ranked(topic_id, position)
      JOIN public.topics topic ON topic.id=ranked.topic_id
      ORDER BY ranked.position
      OFFSET (a.entry->>'offset')::integer
      LIMIT 1
    ) t
    ORDER BY
      CASE WHEN streak >= 2 AND c.slug=last_category THEN 1 ELSE 0 END,
      (a.entry->>'served')::integer,
      c.slug
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

    items := items || jsonb_build_array(jsonb_build_object(
      'id',chosen.id,'slug',chosen.slug,'category',chosen.category_name,
      'categorySlug',chosen.category_slug,
      'question',chosen.question,'answer',chosen.answer,'explanation',chosen.explanation,
      'catechism',jsonb_build_object(
        'paragraphs',coalesce(chosen.catechism_paragraphs,ARRAY[]::text[]),
        'text',chosen.catechism_text
      ),
      'scripture',jsonb_build_object(
        'reference',chosen.scripture_reference,'text',chosen.scripture_text
      )
    ));

    categories := jsonb_set(categories,ARRAY[chosen.position::text],
      chosen.entry || jsonb_build_object(
        'served',(chosen.entry->>'served')::integer+1,
        'offset',(chosen.entry->>'offset')::integer+1
      ));

    IF chosen.category_slug=last_category THEN
      streak:=least(streak+1,2);
    ELSE
      last_category:=chosen.category_slug;
      streak:=1;
    END IF;
    item_count:=item_count+1;
  END LOOP;

  RETURN jsonb_build_object(
    'topics',items,
    'nextCursor',CASE WHEN item_count=page_limit THEN
      jsonb_build_object('categories',categories,'last',last_category,'streak',streak)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_general_topic_page(jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_general_topic_page(jsonb,integer) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';

-- Stop the scheduled job before removing its function or tables.
DO $anonymous_cron_cleanup$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
      USING 'cathoscroll-anonymous-analytics-prune';
  END IF;
END;
$anonymous_cron_cleanup$;

-- Remove all legacy anonymous analytics storage and entry points.
DROP FUNCTION IF EXISTS public.get_admin_anonymous_analytics(uuid, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.get_anonymous_sponsor_campaigns(text, text, text, integer);
DROP FUNCTION IF EXISTS public.record_anonymous_sponsor_campaign_event(text, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.record_anonymous_feed_analytics(jsonb);
DROP FUNCTION IF EXISTS catho_private.prune_anonymous_analytics();

CREATE OR REPLACE FUNCTION catho_private.prune_feed_analytics_events(
  p_before timestamp with time zone DEFAULT (statement_timestamp() - interval '180 days'),
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE
  v_deleted integer := 0;
  v_viewers_deleted integer := 0;
  v_limits_deleted integer := 0;
BEGIN
  IF p_before IS NULL
     OR p_before > statement_timestamp() - interval '180 days'
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Invalid feed analytics retention parameters' USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    SELECT event.ctid
    FROM catho_private.feed_analytics_events AS event
    WHERE event.received_at < p_before
    ORDER BY event.received_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.feed_analytics_events AS event
  USING expired
  WHERE event.ctid = expired.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired_viewers AS (
    SELECT viewer.ctid
    FROM catho_private.feed_analytics_daily_viewers AS viewer
    WHERE viewer.event_date < (p_before AT TIME ZONE 'UTC')::date
    ORDER BY viewer.event_date
    LIMIT p_limit
  )
  DELETE FROM catho_private.feed_analytics_daily_viewers AS viewer
  USING expired_viewers
  WHERE viewer.ctid = expired_viewers.ctid;
  GET DIAGNOSTICS v_viewers_deleted = ROW_COUNT;

  WITH expired_limits AS (
    SELECT event_limit.ctid
    FROM catho_private.feed_analytics_event_limits AS event_limit
    WHERE event_limit.window_started_at < p_before
    ORDER BY event_limit.window_started_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.feed_analytics_event_limits AS event_limit
  USING expired_limits
  WHERE event_limit.ctid = expired_limits.ctid;
  GET DIAGNOSTICS v_limits_deleted = ROW_COUNT;

  RETURN v_deleted + v_viewers_deleted + v_limits_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION catho_private.prune_feed_card_analytics_events(
  p_before timestamp with time zone,
  p_batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
  v_viewers_deleted integer := 0;
  v_limits_deleted integer := 0;
BEGIN
  IF p_before IS NULL
     OR p_before > statement_timestamp() - interval '180 days'
     OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Invalid retention boundary or batch size' USING ERRCODE = '22023';
  END IF;

  WITH expired_viewers AS (
    SELECT viewer.ctid
    FROM catho_private.feed_card_analytics_daily_viewers AS viewer
    WHERE viewer.event_date < (p_before AT TIME ZONE 'UTC')::date
    ORDER BY viewer.event_date
    LIMIT p_batch_size
  )
  DELETE FROM catho_private.feed_card_analytics_daily_viewers AS viewer
  USING expired_viewers
  WHERE viewer.ctid = expired_viewers.ctid;
  GET DIAGNOSTICS v_viewers_deleted = ROW_COUNT;

  WITH expired_events AS (
    SELECT event.ctid
    FROM catho_private.feed_card_analytics_events AS event
    WHERE event.received_at < p_before
    ORDER BY event.received_at
    LIMIT p_batch_size
  )
  DELETE FROM catho_private.feed_card_analytics_events AS event
  USING expired_events
  WHERE event.ctid = expired_events.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired_limits AS (
    SELECT event_limit.ctid
    FROM catho_private.feed_card_analytics_event_limits AS event_limit
    WHERE event_limit.window_started_at < p_before
    ORDER BY event_limit.window_started_at
    LIMIT p_batch_size
  )
  DELETE FROM catho_private.feed_card_analytics_event_limits AS event_limit
  USING expired_limits
  WHERE event_limit.ctid = expired_limits.ctid;
  GET DIAGNOSTICS v_limits_deleted = ROW_COUNT;

  RETURN v_deleted + v_viewers_deleted + v_limits_deleted;
END;
$function$;

ALTER FUNCTION catho_private.prune_feed_analytics_events(timestamptz,integer) OWNER TO postgres;
ALTER FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.prune_feed_analytics_events(timestamptz,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.prune_feed_analytics_events(timestamptz,integer) TO postgres;
GRANT EXECUTE ON FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz,integer) TO postgres;

DO $feed_analytics_retention_cron$
DECLARE
  existing_job record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR existing_job IN
      SELECT jobid FROM cron.job
      WHERE jobname IN (
        'cathoscroll-prune-feed-analytics',
        'cathoscroll-prune-feed-card-analytics'
      )
    LOOP
      PERFORM cron.unschedule(existing_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'cathoscroll-prune-feed-analytics',
      '*/15 * * * *',
      'SELECT catho_private.prune_feed_analytics_events(statement_timestamp() - interval ''180 days'', 5000);'
    );
    PERFORM cron.schedule(
      'cathoscroll-prune-feed-card-analytics',
      '*/15 * * * *',
      'SELECT catho_private.prune_feed_card_analytics_events(statement_timestamp() - interval ''180 days'', 5000);'
    );
  END IF;
END;
$feed_analytics_retention_cron$;


DROP TABLE IF EXISTS catho_private.anonymous_sponsor_session_frequency;
DROP TABLE IF EXISTS catho_private.anonymous_sponsor_events;
DROP TABLE IF EXISTS catho_private.anonymous_sponsor_campaign_daily;
DROP TABLE IF EXISTS catho_private.anonymous_feed_event_receipts;
DROP TABLE IF EXISTS catho_private.anonymous_feed_analytics_daily;

DROP FUNCTION IF EXISTS public.get_admin_sponsor_analytics(uuid, timestamptz, timestamptz);

-- No delivery counters or served events are retained. Frequency is measured only
-- from viewable events for users who opted into Sponsor measurement.
DELETE FROM catho_private.sponsor_campaign_events WHERE event_type = 'served';
ALTER TABLE catho_private.sponsor_campaign_events
  ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0
  CHECK (duration_ms BETWEEN 0 AND 60000);
ALTER TABLE catho_private.sponsor_campaign_daily
  ADD COLUMN IF NOT EXISTS active_duration_ms bigint NOT NULL DEFAULT 0
  CHECK (active_duration_ms >= 0);

ALTER TABLE catho_private.sponsor_campaign_events
  DROP CONSTRAINT IF EXISTS sponsor_campaign_events_event_type_check;
ALTER TABLE catho_private.sponsor_campaign_events
  ADD CONSTRAINT sponsor_campaign_events_event_type_check
  CHECK (event_type IN ('viewable_impression', 'click', 'active_duration'));
ALTER TABLE catho_private.sponsor_campaign_events
  DROP CONSTRAINT IF EXISTS sponsor_campaign_event_duration_check;
ALTER TABLE catho_private.sponsor_campaign_events
  ADD CONSTRAINT sponsor_campaign_event_duration_check CHECK (
    (event_type = 'active_duration' AND duration_ms BETWEEN 1 AND 60000)
    OR (event_type IN ('viewable_impression', 'click') AND duration_ms = 0)
  );
DROP TABLE IF EXISTS catho_private.sponsor_campaign_user_frequency;

NOTIFY pgrst, 'reload schema';


DROP FUNCTION IF EXISTS public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, uuid, text);

-- Corrected consented sponsor event ingestion. A delivery is never recorded:
-- only an opted-in viewable impression or click creates an event row.
CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(
  p_user_id uuid,
  p_campaign_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_inserted integer := 0;
  v_sponsor_consent boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_event_type IS NULL OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT consent.sponsor_measurement INTO v_sponsor_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF coalesce(v_sponsor_consent, false) IS NOT TRUE THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'approved'
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND sponsor.status IN ('active', 'scheduled')
      AND sponsor.payment_status IN ('received', 'not_required')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
  ) THEN
    RAISE EXCEPTION 'Sponsor campaign is not currently eligible' USING ERRCODE = '42501';
  END IF;

  IF p_event_type = 'click' AND NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS viewed
    WHERE viewed.user_id = p_user_id AND viewed.campaign_id = p_campaign_id
      AND viewed.session_id = p_session_id AND viewed.event_type = 'viewable_impression'
  ) THEN
    RAISE EXCEPTION 'Sponsor campaign must be viewable before a click is recorded' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
      AND existing.session_id = p_session_id AND existing.event_type = p_event_type
  ) THEN
    RETURN true;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_events
    (campaign_id, event_id, user_id, session_id, event_type, received_at)
  VALUES (p_campaign_id, p_event_id, p_user_id, p_session_id, p_event_type, statement_timestamp())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
      WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
        AND existing.session_id = p_session_id AND existing.event_type = p_event_type
    );
  END IF;

  INSERT INTO catho_private.sponsor_campaign_daily
    (event_date, campaign_id, viewable_impressions, clicks, updated_at)
  VALUES (
    v_today,
    p_campaign_id,
    CASE WHEN p_event_type = 'viewable_impression' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
    statement_timestamp()
  )
  ON CONFLICT (event_date, campaign_id) DO UPDATE
  SET viewable_impressions = catho_private.sponsor_campaign_daily.viewable_impressions + EXCLUDED.viewable_impressions,
      clicks = catho_private.sponsor_campaign_daily.clicks + EXCLUDED.clicks,
      updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) TO service_role;

-- The delivery selectors intentionally do not enforce impression caps because
-- no delivery counts are collected. Consented frequency limits are enforced
-- from opted-in viewable-impression events by the weighted selector.

DO $anonymous_cron_cleanup_final$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
      USING 'cathoscroll-anonymous-analytics-prune';
  END IF;
END;
$anonymous_cron_cleanup_final$;

NOTIFY pgrst, 'reload schema';


CREATE OR REPLACE FUNCTION public.get_admin_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin WHERE admin.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH metrics AS (
    SELECT campaign.id AS campaign_id,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.clicks), 0) AS clicks
    FROM public.sponsor_campaigns AS campaign
    LEFT JOIN catho_private.sponsor_campaign_daily AS daily
      ON daily.campaign_id = campaign.id AND daily.event_date BETWEEN p_from AND p_to
    GROUP BY campaign.id
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', metrics.campaign_id,
      'viewable_impressions', metrics.viewable_impressions,
      'clicks', metrics.clicks,
      'click_through_rate', CASE WHEN metrics.viewable_impressions > 0
        THEN round(metrics.clicks::numeric * 100 / metrics.viewable_impressions, 2)
        ELSE 0 END
    ) ORDER BY metrics.viewable_impressions DESC, metrics.campaign_id), '[]'::jsonb)
  ) INTO v_result
  FROM metrics;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_overview(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to-p_from > interval '180 days'
    or p_to > statement_timestamp()+interval '1 day' then
    raise exception 'invalid analytics range' using errcode='22023';
  end if;
  with topic_daily as (
    select d.entity_id,d.event_date,d.impressions,d.viewable_impressions,d.active_duration_ms,d.skips,d.completions,d.return_visits
    from catho_private.feed_analytics_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), sponsor_daily as (
    select d.campaign_id,d.event_date,d.viewable_impressions,d.clicks,d.active_duration_ms
    from catho_private.sponsor_campaign_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), comment_daily as (
    select d.card_id,d.event_date,d.impressions,d.viewable_impressions,d.active_duration_ms,d.skips,d.completions,d.opens,d.unique_viewers
    from catho_private.feed_card_analytics_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), totals as (
    select
      coalesce((select sum(impressions) from topic_daily),0) topic_impressions,
      coalesce((select sum(viewable_impressions) from topic_daily),0) topic_viewable_impressions,
      coalesce((select sum(active_duration_ms) from topic_daily),0) topic_active_duration_ms,
      coalesce((select sum(skips) from topic_daily),0) topic_skips,
      coalesce((select sum(completions) from topic_daily),0) topic_completions,
      coalesce((select sum(viewable_impressions) from sponsor_daily),0) sponsor_viewable_impressions,
      coalesce((select sum(clicks) from sponsor_daily),0) sponsor_clicks,
      coalesce((select sum(active_duration_ms) from sponsor_daily),0) sponsor_active_duration_ms,
      coalesce((select sum(active_duration_ms) from sponsor_daily),0) sponsor_active_duration_ms,
      coalesce((select sum(active_duration_ms) from sponsor_daily),0) sponsor_active_duration_ms,
      coalesce((select sum(active_duration_ms) from sponsor_daily),0) sponsor_active_duration_ms,
      coalesce((select sum(impressions) from comment_daily),0) comment_card_impressions,
      coalesce((select sum(viewable_impressions) from comment_daily),0) comment_card_viewable_impressions,
      coalesce((select sum(active_duration_ms) from comment_daily),0) comment_card_active_duration_ms,
      coalesce((select sum(skips) from comment_daily),0) comment_card_skips,
      coalesce((select sum(opens) from comment_daily),0) comment_card_opens,
      (select count(*) from public.categories) category_count,
      (select count(*) from public.topics) topic_count,
      (select count(*) from public.sponsors) sponsor_count,
      (select count(*) from public.comments where is_deleted=false and parent_id is null) comment_count
  ), categories as (
    select c.slug,c.name,count(t.id) topic_count,
      coalesce(sum(td.impressions),0) impressions,coalesce(sum(td.viewable_impressions),0) viewable_impressions
    from public.categories c
    left join public.topics t on t.category_slug=c.slug
    left join topic_daily td on td.entity_id=t.id
    group by c.slug,c.name
    order by impressions desc,c.name
  ), topics as (
    select t.id,t.slug,t.question,t.category_slug,
      coalesce(sum(td.impressions),0) impressions,coalesce(sum(td.viewable_impressions),0) viewable_impressions,
      coalesce(sum(td.active_duration_ms),0) active_duration_ms
    from public.topics t left join topic_daily td on td.entity_id=t.id
    group by t.id,t.slug,t.question,t.category_slug
    order by impressions desc,t.question
    limit 100
  ), sponsors as (
    select s.id,s.sponsor_name,s.status,count(distinct sc.id) campaign_count,
      coalesce(sum(sd.viewable_impressions),0) viewable_impressions,
      coalesce(sum(sd.clicks),0) clicks,
      coalesce(sum(sd.active_duration_ms),0) active_duration_ms,
      coalesce(sum(sd.active_duration_ms),0) active_duration_ms
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id
    group by s.id,s.sponsor_name,s.status
    order by viewable_impressions desc,s.sponsor_name
    limit 100
  ), comments as (
    select c.id,c.topic_id,t.question topic_question,c.created_at,
      coalesce(cd.impressions,0) impressions,coalesce(cd.viewable_impressions,0) viewable_impressions,
      coalesce(cd.active_duration_ms,0) active_duration_ms,coalesce(cd.skips,0) skips,
      coalesce(cd.opens,0) opens,
      (select count(*) from public.comment_likes cl where cl.comment_id=c.id) likes,
      (select count(*) from public.comments r where r.parent_id=c.id and r.is_deleted=false) replies
    from public.comments c left join public.topics t on t.id=c.topic_id
    left join (select card_id,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions,
      sum(active_duration_ms) active_duration_ms,sum(skips) skips,sum(opens) opens
      from comment_daily group by card_id) cd on cd.card_id=c.id::text
    where c.parent_id is null and c.is_deleted=false
    order by impressions desc,c.created_at desc
    limit 100
  )
  select jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),
    'categories',(select coalesce(jsonb_agg(to_jsonb(categories)),'[]'::jsonb) from categories),
    'topics',(select coalesce(jsonb_agg(to_jsonb(topics)),'[]'::jsonb) from topics),
    'sponsors',(select coalesce(jsonb_agg(to_jsonb(sponsors)),'[]'::jsonb) from sponsors),
    'comments',(select coalesce(jsonb_agg(to_jsonb(comments)),'[]'::jsonb) from comments)
  ) into v_result;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_admin_analytics_series(p_actor_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if p_actor_user_id is null or not exists(select 1 from public.admin_users where user_id=p_actor_user_id) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '180 days'
    or p_to>statement_timestamp()+interval '1 day' then raise exception 'invalid analytics range' using errcode='22023'; end if;
  with days as (
    select d::date event_date from generate_series(date_trunc('day',p_from),date_trunc('day',p_to),interval '1 day') d
  ), topic as (
    select event_date,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions
    from catho_private.feed_analytics_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  ), sponsor as (
    select event_date,sum(viewable_impressions) viewable_impressions,sum(clicks) clicks,sum(active_duration_ms) active_duration_ms
    from catho_private.sponsor_campaign_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  ), comments as (
    select event_date,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions
    from catho_private.feed_card_analytics_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_date',d.event_date,
    'topic_impressions',coalesce(t.impressions,0),'topic_viewable_impressions',coalesce(t.viewable_impressions,0),
    'sponsor_viewable_impressions',coalesce(s.viewable_impressions,0),
    'sponsor_clicks',coalesce(s.clicks,0),'sponsor_active_duration_ms',coalesce(s.active_duration_ms,0),'comment_impressions',coalesce(c.impressions,0),
    'comment_viewable_impressions',coalesce(c.viewable_impressions,0)) order by d.event_date),'[]'::jsonb)
  into v_result from days d left join topic t using(event_date) left join sponsor s using(event_date) left join comments c using(event_date);
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_analytics_series(uuid, timestamp with time zone, timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_analytics_series(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_series(uuid, timestamp with time zone, timestamp with time zone) TO service_role;

CREATE TABLE IF NOT EXISTS catho_private.sponsor_campaign_placement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  viewable_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_campaign_placement_receipts_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sponsor_campaign_placement_receipts_expiry_idx
  ON catho_private.sponsor_campaign_placement_receipts(expires_at);
CREATE INDEX IF NOT EXISTS sponsor_campaign_placement_receipts_user_idx
  ON catho_private.sponsor_campaign_placement_receipts(user_id, campaign_id);
ALTER TABLE catho_private.sponsor_campaign_placement_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_placement_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catho_private.prune_sponsor_campaign_events(
  p_before timestamptz DEFAULT (statement_timestamp() - interval '180 days'),
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
  v_receipts_deleted integer := 0;
BEGIN
  IF p_before IS NULL OR p_before > statement_timestamp() - interval '180 days'
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Invalid sponsor campaign retention parameters' USING ERRCODE = '22023';
  END IF;

  WITH expired_campaigns AS (
    SELECT campaign.id
    FROM public.sponsor_campaigns AS campaign
    LEFT JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status IN ('approved', 'paused')
      AND (
        campaign.ends_on < (p_before AT TIME ZONE 'UTC')::date
        OR sponsor.status = 'completed'
        OR (sponsor.ends_on IS NOT NULL AND sponsor.ends_on < (p_before AT TIME ZONE 'UTC')::date)
      )
    ORDER BY campaign.ends_on, campaign.id
    LIMIT p_limit
  )
  UPDATE public.sponsor_campaigns AS campaign
  SET status = 'completed', updated_at = statement_timestamp()
  FROM expired_campaigns
  WHERE campaign.id = expired_campaigns.id;

  WITH expired_events AS (
    SELECT event.ctid FROM catho_private.sponsor_campaign_events AS event
    WHERE event.received_at < p_before
    ORDER BY event.received_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_events AS event
  USING expired_events WHERE event.ctid = expired_events.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired_receipts AS (
    SELECT receipt.ctid FROM catho_private.sponsor_campaign_placement_receipts AS receipt
    WHERE receipt.expires_at <= statement_timestamp()
    ORDER BY receipt.expires_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_placement_receipts AS receipt
  USING expired_receipts WHERE receipt.ctid = expired_receipts.ctid;
  GET DIAGNOSTICS v_receipts_deleted = ROW_COUNT;

  RETURN v_deleted + v_receipts_deleted;
END;
$function$;
ALTER FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(
  p_user_id uuid,
  p_session_id uuid,
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_receipt uuid;
  v_slot integer;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor measurement request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT coalesce(consent.sponsor_measurement, false) INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF NOT coalesce(v_sponsor_measurement, false) THEN
    RAISE EXCEPTION 'Sponsor measurement consent required' USING ERRCODE = '42501';
  END IF;
  IF p_topic_id IS NULL OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR (p_category_slug IS NOT NULL AND p_category_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'Invalid sponsor placement topic' USING ERRCODE = '22023';
  END IF;

  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND OR (p_category_slug IS NOT NULL AND p_category_slug <> v_topic_category_slug) THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND (campaign.daily_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today
      ), 0) < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS recent
        WHERE recent.user_id = p_user_id AND recent.campaign_id = campaign.id
          AND recent.event_type = 'viewable_impression'
          AND recent.received_at >= statement_timestamp() - interval '24 hours') < campaign.frequency_cap_per_user_24h
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS lifetime
        WHERE lifetime.user_id = p_user_id AND lifetime.campaign_id = campaign.id
          AND lifetime.event_type = 'viewable_impression'
          AND lifetime.received_at >= statement_timestamp() - interval '180 days') < campaign.frequency_cap_per_user_total
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY
      -ln(greatest(pg_catalog.random(), 0.000000000001))
        / (campaign.placement_weight::numeric / (1 + coalesce((
          SELECT sum(daily.viewable_impressions)
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today
        ), 0))) ASC,
      campaign.id
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

    v_receipt := pg_catalog.gen_random_uuid();
    INSERT INTO catho_private.sponsor_campaign_placement_receipts
      (id, campaign_id, user_id, session_id, expires_at)
    VALUES (v_receipt, v_campaign.id, p_user_id, p_session_id,
      pg_catalog.statement_timestamp() + interval '7 days');

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored',
      'measurement_receipt', v_receipt
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

DROP FUNCTION IF EXISTS public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(
  p_user_id uuid,
  p_campaign_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_duration_ms integer,
  p_placement_receipt uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_inserted integer := 0;
  v_sponsor_consent boolean := false;
  v_receipt catho_private.sponsor_campaign_placement_receipts%ROWTYPE;
  v_campaign public.sponsor_campaigns%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_placement_receipt IS NULL OR p_event_type IS NULL
     OR p_event_type NOT IN ('viewable_impression', 'click', 'active_duration')
     OR (p_event_type = 'active_duration' AND (p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 1 AND 60000))
     OR (p_event_type <> 'active_duration' AND coalesce(p_duration_ms, 0) <> 0)
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT consent.sponsor_measurement INTO v_sponsor_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF coalesce(v_sponsor_consent, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sponsor measurement consent is not active' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_receipt
  FROM catho_private.sponsor_campaign_placement_receipts AS receipt
  WHERE receipt.id = p_placement_receipt
    AND receipt.campaign_id = p_campaign_id
    AND receipt.user_id = p_user_id
    AND receipt.session_id = p_session_id
    AND receipt.expires_at > pg_catalog.statement_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor placement receipt is invalid or expired' USING ERRCODE = '42501';
  END IF;

  IF p_event_type IN ('click', 'active_duration') AND v_receipt.viewable_at IS NULL THEN
    RAISE EXCEPTION 'Sponsor campaign must be viewable before a click is recorded' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.campaign_id = p_campaign_id AND existing.event_id = p_event_id
  ) THEN
    RETURN true;
  END IF;

  IF p_event_type IN ('viewable_impression', 'click') AND EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
      AND existing.session_id = p_session_id AND existing.event_type = p_event_type
  ) THEN
    IF p_event_type = 'viewable_impression' THEN
      UPDATE catho_private.sponsor_campaign_placement_receipts
      SET viewable_at = coalesce(viewable_at, pg_catalog.statement_timestamp())
      WHERE id = p_placement_receipt;
    END IF;
    RETURN true;
  END IF;

  IF p_event_type = 'viewable_impression' THEN
    -- Serialize viewability recording per campaign so simultaneous placements
    -- cannot pass the same impression/frequency caps before either is counted.
    SELECT campaign.* INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;

    IF (v_campaign.daily_impression_cap IS NOT NULL AND coalesce((
          SELECT sum(daily.viewable_impressions)
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = p_campaign_id AND daily.event_date = v_today
        ), 0) >= v_campaign.daily_impression_cap)
       OR (v_campaign.total_impression_cap IS NOT NULL AND coalesce((
          SELECT sum(daily.viewable_impressions)
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = p_campaign_id
        ), 0) >= v_campaign.total_impression_cap)
       OR (SELECT count(*) FROM catho_private.sponsor_campaign_events AS recent
          WHERE recent.user_id = p_user_id AND recent.campaign_id = p_campaign_id
            AND recent.event_type = 'viewable_impression'
            AND recent.received_at >= pg_catalog.statement_timestamp() - interval '24 hours')
          >= v_campaign.frequency_cap_per_user_24h
       OR (SELECT count(*) FROM catho_private.sponsor_campaign_events AS lifetime
          WHERE lifetime.user_id = p_user_id AND lifetime.campaign_id = p_campaign_id
            AND lifetime.event_type = 'viewable_impression'
            AND lifetime.received_at >= pg_catalog.statement_timestamp() - interval '180 days')
          >= v_campaign.frequency_cap_per_user_total THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_events
    (campaign_id, event_id, user_id, session_id, event_type, duration_ms, received_at)
  VALUES (p_campaign_id, p_event_id, p_user_id, p_session_id, p_event_type, coalesce(p_duration_ms, 0), pg_catalog.statement_timestamp())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
      WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
        AND existing.session_id = p_session_id AND existing.event_type = p_event_type
    );
  END IF;

  IF p_event_type = 'viewable_impression' THEN
    UPDATE catho_private.sponsor_campaign_placement_receipts
    SET viewable_at = pg_catalog.statement_timestamp()
    WHERE id = p_placement_receipt;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_daily
    (event_date, campaign_id, viewable_impressions, clicks, active_duration_ms, updated_at)
  VALUES (
    v_today, p_campaign_id,
    CASE WHEN p_event_type = 'viewable_impression' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'active_duration' THEN coalesce(p_duration_ms, 0) ELSE 0 END,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (event_date, campaign_id) DO UPDATE
  SET viewable_impressions = catho_private.sponsor_campaign_daily.viewable_impressions + EXCLUDED.viewable_impressions,
      clicks = catho_private.sponsor_campaign_daily.clicks + EXCLUDED.clicks,
      active_duration_ms = catho_private.sponsor_campaign_daily.active_duration_ms + EXCLUDED.active_duration_ms,
      updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text, integer, uuid) TO service_role;

-- Permanently remove all sponsor delivery counters from the existing database.
ALTER TABLE public.sponsor_campaigns DROP COLUMN IF EXISTS served_count;
ALTER TABLE catho_private.sponsor_campaign_daily DROP COLUMN IF EXISTS served_count;
NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.get_admin_analytics_overview(p_actor_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if p_actor_user_id is null or not exists(select 1 from public.admin_users where user_id=p_actor_user_id) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to-p_from > interval '180 days'
    or p_to > statement_timestamp()+interval '1 day' then
    raise exception 'invalid analytics range' using errcode='22023';
  end if;
  with topic_daily as (
    select d.entity_id,d.event_date,d.impressions,d.viewable_impressions,d.active_duration_ms,d.skips,d.completions,d.return_visits
    from catho_private.feed_analytics_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), sponsor_daily as (
    select d.campaign_id,d.event_date,d.viewable_impressions,d.clicks,d.active_duration_ms
    from catho_private.sponsor_campaign_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), comment_daily as (
    select d.card_id,d.event_date,d.impressions,d.viewable_impressions,d.active_duration_ms,d.skips,d.completions,d.opens,d.unique_viewers
    from catho_private.feed_card_analytics_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), totals as (
    select
      coalesce((select sum(impressions) from topic_daily),0) topic_impressions,
      coalesce((select sum(viewable_impressions) from topic_daily),0) topic_viewable_impressions,
      coalesce((select sum(active_duration_ms) from topic_daily),0) topic_active_duration_ms,
      coalesce((select sum(skips) from topic_daily),0) topic_skips,
      coalesce((select sum(completions) from topic_daily),0) topic_completions,
      coalesce((select sum(viewable_impressions) from sponsor_daily),0) sponsor_viewable_impressions,
      coalesce((select sum(clicks) from sponsor_daily),0) sponsor_clicks,
      coalesce((select sum(active_duration_ms) from sponsor_daily),0) sponsor_active_duration_ms,
      coalesce((select sum(impressions) from comment_daily),0) comment_card_impressions,
      coalesce((select sum(viewable_impressions) from comment_daily),0) comment_card_viewable_impressions,
      coalesce((select sum(active_duration_ms) from comment_daily),0) comment_card_active_duration_ms,
      coalesce((select sum(skips) from comment_daily),0) comment_card_skips,
      coalesce((select sum(opens) from comment_daily),0) comment_card_opens,
      (select count(*) from public.categories) category_count,
      (select count(*) from public.topics) topic_count,
      (select count(*) from public.sponsors) sponsor_count,
      (select count(*) from public.comments where is_deleted=false and parent_id is null) comment_count,
      coalesce((select count(distinct user_id) from catho_private.feed_analytics_daily_viewers
        where event_date >= p_from::date and event_date <= p_to::date),0) unique_topic_viewers,
      coalesce((select count(distinct user_id) from catho_private.sponsor_campaign_events
        where event_type='viewable_impression' and received_at >= p_from and received_at < p_to),0) unique_sponsor_viewers,
      coalesce((select count(distinct user_id) from catho_private.feed_card_analytics_daily_viewers
        where event_date >= p_from::date and event_date <= p_to::date),0) unique_comment_viewers,
      coalesce((select count(distinct user_id) from (
        select user_id from catho_private.feed_analytics_daily_viewers
          where event_date >= p_from::date and event_date <= p_to::date
        union
        select user_id from catho_private.sponsor_campaign_events
          where event_type='viewable_impression' and received_at >= p_from and received_at < p_to
        union
        select user_id from catho_private.feed_card_analytics_daily_viewers
          where event_date >= p_from::date and event_date <= p_to::date
      ) AS opted_in_viewers),0) unique_feed_viewers,
      (select count(*) from public.topic_likes where created_at >= p_from and created_at < p_to) topic_likes,
      (select count(*) from public.bookmarks where created_at >= p_from and created_at < p_to) bookmarks,
      (select count(*) from public.progress where completed_at >= p_from and completed_at < p_to) completed_topics,
      (select count(*) from public.comments where parent_id is null and is_deleted=false and created_at >= p_from and created_at < p_to) comments_created,
      (select count(*) from public.comments where parent_id is not null and is_deleted=false and created_at >= p_from and created_at < p_to) replies,
      (select count(*) from public.comment_likes where created_at >= p_from and created_at < p_to) comment_likes
  ), categories as (
    select c.slug,c.name,count(t.id) topic_count,
      coalesce(sum(td.impressions),0) impressions,coalesce(sum(td.viewable_impressions),0) viewable_impressions
    from public.categories c
    left join public.topics t on t.category_slug=c.slug
    left join topic_daily td on td.entity_id=t.id
    group by c.slug,c.name
    order by impressions desc,c.name
  ), topics as (
    select t.id,t.slug,t.question,t.category_slug,
      coalesce(sum(td.impressions),0) impressions,coalesce(sum(td.viewable_impressions),0) viewable_impressions,
      coalesce(sum(td.active_duration_ms),0) active_duration_ms
    from public.topics t left join topic_daily td on td.entity_id=t.id
    group by t.id,t.slug,t.question,t.category_slug
    order by impressions desc,t.question
    limit 100
  ), sponsors as (
    select s.id,s.sponsor_name,s.status,count(distinct sc.id) campaign_count,
      coalesce(sum(sd.viewable_impressions),0) viewable_impressions,
      coalesce(sum(sd.clicks),0) clicks,
      coalesce(sum(sd.active_duration_ms),0) active_duration_ms
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id
    group by s.id,s.sponsor_name,s.status
    order by viewable_impressions desc,s.sponsor_name
    limit 100
  ), comments as (
    select c.id,c.topic_id,t.question topic_question,c.created_at,
      coalesce(cd.impressions,0) impressions,coalesce(cd.viewable_impressions,0) viewable_impressions,
      coalesce(cd.active_duration_ms,0) active_duration_ms,coalesce(cd.skips,0) skips,
      coalesce(cd.opens,0) opens,
      (select count(*) from public.comment_likes cl where cl.comment_id=c.id) likes,
      (select count(*) from public.comments r where r.parent_id=c.id and r.is_deleted=false) replies
    from public.comments c left join public.topics t on t.id=c.topic_id
    left join (select card_id,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions,
      sum(active_duration_ms) active_duration_ms,sum(skips) skips,sum(opens) opens
      from comment_daily group by card_id) cd on cd.card_id=c.id::text
    where c.parent_id is null and c.is_deleted=false
    order by impressions desc,c.created_at desc
    limit 100
  )
  select jsonb_build_object(
    'totals',(select to_jsonb(totals) from totals),
    'categories',(select coalesce(jsonb_agg(to_jsonb(categories)),'[]'::jsonb) from categories),
    'topics',(select coalesce(jsonb_agg(to_jsonb(topics)),'[]'::jsonb) from topics),
    'sponsors',(select coalesce(jsonb_agg(to_jsonb(sponsors)),'[]'::jsonb) from sponsors),
    'comments',(select coalesce(jsonb_agg(to_jsonb(comments)),'[]'::jsonb) from comments)
  ) into v_result;
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) TO service_role;
DROP FUNCTION IF EXISTS public.get_admin_analytics_overview(timestamp with time zone, timestamp with time zone);

NOTIFY pgrst, 'reload schema';


-- Withdrawal cleanup: remove account-linked event records for a withdrawn
-- purpose, then rebuild the affected daily aggregates from the remaining
-- currently-consented event ledger. Historical aggregates outside the raw
-- retention window remain non-identifying campaign/content totals.

CREATE OR REPLACE FUNCTION catho_private.purge_user_service_improvement_events(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_deleted integer := 0;
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT min(event_date), max(event_date)
  INTO v_from, v_to
  FROM (
    SELECT (event.received_at AT TIME ZONE 'UTC')::date AS event_date
    FROM catho_private.feed_analytics_events AS event
    WHERE event.user_id = p_user_id
    UNION ALL
    SELECT (event.received_at AT TIME ZONE 'UTC')::date AS event_date
    FROM catho_private.feed_card_analytics_events AS event
    WHERE event.user_id = p_user_id
  ) AS affected_dates;

  -- Preserve older non-identifying daily totals after raw events are pruned.
  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    v_from := greatest(v_from, (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date - 179);
    v_to := least(v_to, (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date);
  END IF;

  DELETE FROM catho_private.feed_analytics_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM catho_private.feed_card_analytics_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM catho_private.feed_analytics_event_limits WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_card_analytics_event_limits WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_analytics_daily_viewers WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_card_analytics_daily_viewers WHERE user_id = p_user_id;

  IF pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
    IF pg_catalog.to_regprocedure('catho_private.refresh_user_interest_profile(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT catho_private.refresh_user_interest_profile($1)' USING p_user_id;
    END IF;
  END IF;

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN v_deleted;
  END IF;

  DELETE FROM catho_private.feed_analytics_daily
  WHERE event_date BETWEEN v_from AND v_to;

  INSERT INTO catho_private.feed_analytics_daily (
    event_date, entity_id, impressions, viewable_impressions,
    active_duration_ms, skips, completions, return_visits, refreshed_at
  )
  SELECT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.entity_id,
    count(*) FILTER (WHERE event.event_type = 'impression'),
    count(*) FILTER (WHERE event.event_type = 'viewable_impression'),
    coalesce(sum((event.metadata ->> 'duration_ms')::bigint)
      FILTER (WHERE event.event_type = 'active_duration'), 0),
    count(*) FILTER (WHERE event.event_type = 'skip'),
    count(*) FILTER (WHERE event.event_type = 'completion'),
    count(*) FILTER (WHERE event.event_type = 'return_visit'),
    pg_catalog.statement_timestamp()
  FROM catho_private.feed_analytics_events AS event
  WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.entity_id;

  DELETE FROM catho_private.feed_analytics_daily_viewers
  WHERE event_date BETWEEN v_from AND v_to;

  INSERT INTO catho_private.feed_analytics_daily_viewers (event_date, entity_id, user_id)
  SELECT DISTINCT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.entity_id,
    event.user_id
  FROM catho_private.feed_analytics_events AS event
  WHERE event.event_type = 'viewable_impression'
    AND (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  ON CONFLICT DO NOTHING;

  DELETE FROM catho_private.feed_card_analytics_daily
  WHERE event_date BETWEEN v_from AND v_to;

  DELETE FROM catho_private.feed_card_analytics_daily_viewers
  WHERE event_date BETWEEN v_from AND v_to;

  INSERT INTO catho_private.feed_card_analytics_daily_viewers (
    event_date, card_type, card_id, user_id
  )
  SELECT DISTINCT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.card_type,
    event.card_id,
    event.user_id
  FROM catho_private.feed_card_analytics_events AS event
  WHERE event.event_type IN ('impression', 'viewable_impression')
    AND (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  ON CONFLICT DO NOTHING;

  WITH event_totals AS (
    SELECT
      (event.received_at AT TIME ZONE 'UTC')::date AS event_date,
      event.card_type,
      event.card_id,
      count(*) FILTER (WHERE event.event_type = 'impression') AS impressions,
      count(*) FILTER (WHERE event.event_type = 'viewable_impression') AS viewable_impressions,
      coalesce(sum(event.duration_ms) FILTER (WHERE event.event_type = 'active_duration'), 0) AS active_duration_ms,
      count(*) FILTER (WHERE event.event_type = 'skip') AS skips,
      count(*) FILTER (WHERE event.event_type = 'completion') AS completions,
      count(*) FILTER (WHERE event.event_type = 'open') AS opens
    FROM catho_private.feed_card_analytics_events AS event
    WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
    GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.card_type, event.card_id
  ),
  viewer_totals AS (
    SELECT event_date, card_type, card_id, count(*) AS unique_viewers
    FROM catho_private.feed_card_analytics_daily_viewers
    WHERE event_date BETWEEN v_from AND v_to
    GROUP BY event_date, card_type, card_id
  )
  INSERT INTO catho_private.feed_card_analytics_daily (
    event_date, card_type, card_id, impressions, viewable_impressions,
    active_duration_ms, skips, completions, opens, unique_viewers, refreshed_at
  )
  SELECT
    event_totals.event_date,
    event_totals.card_type,
    event_totals.card_id,
    event_totals.impressions,
    event_totals.viewable_impressions,
    event_totals.active_duration_ms,
    event_totals.skips,
    event_totals.completions,
    event_totals.opens,
    coalesce(viewer_totals.unique_viewers, 0),
    pg_catalog.statement_timestamp()
  FROM event_totals
  LEFT JOIN viewer_totals USING (event_date, card_type, card_id);

  RETURN v_deleted;
END;
$function$;
ALTER FUNCTION catho_private.purge_user_service_improvement_events(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.purge_user_service_improvement_events(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catho_private.purge_user_sponsor_measurement_events(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT min((event.received_at AT TIME ZONE 'UTC')::date),
         max((event.received_at AT TIME ZONE 'UTC')::date)
  INTO v_from, v_to
  FROM catho_private.sponsor_campaign_events AS event
  WHERE event.user_id = p_user_id;

  -- Only rebuild dates whose complete raw-event ledger is still retained.
  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    v_from := greatest(v_from, (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date - 179);
    v_to := least(v_to, (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date);
  END IF;

  DELETE FROM catho_private.sponsor_campaign_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM catho_private.sponsor_campaign_placement_receipts WHERE user_id = p_user_id;

  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    DELETE FROM catho_private.sponsor_campaign_daily
    WHERE event_date BETWEEN v_from AND v_to;

    INSERT INTO catho_private.sponsor_campaign_daily (
      event_date, campaign_id, viewable_impressions, clicks, active_duration_ms, updated_at
    )
    SELECT
      (event.received_at AT TIME ZONE 'UTC')::date,
      event.campaign_id,
      count(*) FILTER (WHERE event.event_type = 'viewable_impression'),
      count(*) FILTER (WHERE event.event_type = 'click'),
      coalesce(sum(event.duration_ms) FILTER (WHERE event.event_type = 'active_duration'), 0),
      pg_catalog.statement_timestamp()
    FROM catho_private.sponsor_campaign_events AS event
    WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
    GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.campaign_id;
  END IF;

  RETURN v_deleted;
END;
$function$;
ALTER FUNCTION catho_private.purge_user_sponsor_measurement_events(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.purge_user_sponsor_measurement_events(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
     OR p_consent_version IS DISTINCT FROM 2
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid analytics consent update' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR UPDATE;

  IF p_service_improvement IS NOT TRUE AND EXISTS (
    SELECT 1 FROM catho_private.user_personalization_consents AS personalization
    WHERE personalization.user_id = p_user_id
      AND personalization.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'Turn off Personalisation before withdrawing Service improvement analytics'
      USING ERRCODE = '42501';
  END IF;

  SELECT service_improvement, sponsor_measurement
  INTO v_previous_service, v_previous_sponsor
  FROM catho_private.user_analytics_consents
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- An all-unchecked state is undecided, not a persisted refusal.
  -- Preserve evidence only when this call revokes a previously granted purpose.
  IF p_service_improvement IS FALSE AND p_sponsor_measurement IS FALSE THEN
    IF v_previous_service IS TRUE OR v_previous_sponsor IS TRUE THEN
      INSERT INTO catho_private.user_analytics_consent_history (
        user_id, previous_service_improvement, previous_sponsor_measurement,
        service_improvement, sponsor_measurement, consent_version, recorded_at
      ) VALUES (
        p_user_id, v_previous_service, v_previous_sponsor,
        false, false, p_consent_version, v_now
      );
    END IF;
    DELETE FROM catho_private.user_analytics_consents WHERE user_id = p_user_id;
    PERFORM catho_private.purge_user_service_improvement_events(p_user_id);
    PERFORM catho_private.purge_user_sponsor_measurement_events(p_user_id);
    RETURN public.get_user_analytics_consent(p_user_id);
  END IF;

  IF v_previous_service IS NOT NULL
     AND v_previous_service = p_service_improvement
     AND v_previous_sponsor = p_sponsor_measurement THEN
    IF p_service_improvement IS NOT TRUE THEN
      PERFORM catho_private.purge_user_service_improvement_events(p_user_id);
    END IF;
    IF p_sponsor_measurement IS NOT TRUE THEN
      PERFORM catho_private.purge_user_sponsor_measurement_events(p_user_id);
    END IF;
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

  IF v_previous_service IS DISTINCT FROM p_service_improvement
     AND pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
  END IF;

  IF p_service_improvement IS NOT TRUE THEN
    PERFORM catho_private.purge_user_service_improvement_events(p_user_id);
  END IF;

  IF p_sponsor_measurement IS NOT TRUE THEN
    PERFORM catho_private.purge_user_sponsor_measurement_events(p_user_id);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', EXISTS (
      SELECT 1 FROM catho_private.user_personalization_consents AS pc
      WHERE pc.user_id = p_user_id AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
    )
  );
END;
$function$;
ALTER FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;

DO $consent_cleanup$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN
    SELECT user_id
    FROM catho_private.user_analytics_consents
    WHERE service_improvement IS NOT TRUE OR sponsor_measurement IS NOT TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM catho_private.user_analytics_consents
      WHERE user_id = v_user.user_id AND service_improvement IS TRUE
    ) THEN
      PERFORM catho_private.purge_user_service_improvement_events(v_user.user_id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM catho_private.user_analytics_consents
      WHERE user_id = v_user.user_id AND sponsor_measurement IS TRUE
    ) THEN
      PERFORM catho_private.purge_user_sponsor_measurement_events(v_user.user_id);
    END IF;
  END LOOP;
END;
$consent_cleanup$;

NOTIFY pgrst, 'reload schema';


-- Return the current analytics-consent disclosure version, including the
-- explicit undecided state after the one-time release reset.
CREATE OR REPLACE FUNCTION public.get_user_analytics_consent(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_consent catho_private.user_analytics_consents%ROWTYPE;
  v_personalization_enabled boolean := false;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid account for analytics consent lookup' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    SELECT coalesce(pc.enabled, false) INTO v_personalization_enabled
    FROM (SELECT p_user_id AS user_id) AS actor
    LEFT JOIN catho_private.user_personalization_consents AS pc ON pc.user_id = actor.user_id;
  END IF;
  SELECT * INTO v_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'serviceImprovement', false,
      'sponsorMeasurement', false,
      'updatedAt', NULL,
      'version', 2,
      'exists', false,
      'personalizationEnabled', v_personalization_enabled
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', v_personalization_enabled
  );
END;
$function$;
ALTER FUNCTION public.get_user_analytics_consent(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_user_analytics_consent(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_analytics_consent(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
