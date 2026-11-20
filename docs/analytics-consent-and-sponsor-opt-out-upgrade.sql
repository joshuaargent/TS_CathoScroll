-- CathoScroll optional analytics consent and sponsor-measurement opt-out.
-- Validate against both a clean bootstrap and an existing CathoScroll database
-- before production execution. Declining measurement does not suppress sponsor
-- delivery or campaign/day served totals; it suppresses visitor/session frequency
-- records and viewability/click measurement.
-- Idempotent. Existing analytics events and aggregate history are preserved.

CREATE TABLE IF NOT EXISTS catho_private.user_analytics_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  service_improvement boolean NOT NULL DEFAULT false,
  sponsor_measurement boolean NOT NULL DEFAULT false,
  consent_version integer NOT NULL DEFAULT 1 CHECK (consent_version >= 1),
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
REVOKE ALL ON FUNCTION public.record_feed_analytics_events(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
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
REVOKE ALL ON FUNCTION public.record_feed_card_analytics_events(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
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
  ) THEN RAISE EXCEPTION 'Sponsor campaign must be viewable before a click is recorded' USING ERRCODE = '42501'; END IF;
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
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text)
  TO service_role;

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
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_anonymous_sponsor_campaigns(p_session_token text, p_category_slug text DEFAULT NULL::text, p_topic_id text DEFAULT NULL::text, p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_campaign record; v_campaign_ids uuid[]:=ARRAY[]::uuid[]; v_campaigns jsonb:='[]'::jsonb;
 v_slot integer; v_today date:=(pg_catalog.timezone('UTC',statement_timestamp()))::date;
 v_hash text; v_topic_category_slug text;
BEGIN
 IF (p_session_token IS NOT NULL AND (length(p_session_token)>100 OR p_session_token !~* '^[0-9a-f-]{36}
   OR p_limit IS NULL OR p_limit<1 OR p_limit>1
   OR (p_category_slug IS NOT NULL AND p_category_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
   OR (p_topic_id IS NOT NULL AND p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
   RAISE EXCEPTION 'Invalid anonymous sponsor request' USING ERRCODE='22023';
 END IF;
 IF p_topic_id IS NULL THEN RAISE EXCEPTION 'Sponsor placement topic is required' USING ERRCODE='22023'; END IF;
 IF p_session_token IS NOT NULL THEN
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session_token,'UTF8')),'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash,9173));
 END IF;
 SELECT t.category_slug INTO v_topic_category_slug FROM public.topics t WHERE t.id=p_topic_id AND t.is_published;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE='22023'; END IF;
 FOR v_slot IN 1..p_limit LOOP
  SELECT campaign.id,sponsor.sponsor_name,campaign.headline,campaign.body,campaign.image_url,campaign.destination_url,campaign.cta_label,campaign.campaign_name
  INTO v_campaign
  FROM public.sponsor_campaigns campaign JOIN public.sponsors sponsor ON sponsor.id=campaign.sponsor_id
  LEFT JOIN catho_private.anonymous_sponsor_session_frequency frequency ON frequency.campaign_id=campaign.id AND frequency.session_hash=v_hash AND p_session_token IS NOT NULL
  WHERE campaign.status='approved' AND sponsor.status IN ('active','scheduled')
    AND (sponsor.starts_on IS NULL OR sponsor.starts_on<=v_today) AND (sponsor.ends_on IS NULL OR sponsor.ends_on>=v_today)
    AND sponsor.payment_status IN ('received','not_required')
    AND campaign.starts_on<=v_today AND campaign.ends_on>=v_today
    AND (cardinality(campaign.target_category_slugs)=0 OR v_topic_category_slug=ANY(campaign.target_category_slugs))
    AND (cardinality(campaign.target_topic_ids)=0 OR (p_topic_id IS NOT NULL AND p_topic_id=ANY(campaign.target_topic_ids)))
    AND (campaign.daily_impression_cap IS NULL OR coalesce((SELECT d.served_count FROM catho_private.sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date=v_today),0)
      + coalesce((SELECT d.served_count FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date=v_today),0) < campaign.daily_impression_cap)
    AND (campaign.total_impression_cap IS NULL OR campaign.served_count + coalesce((SELECT sum(d.served_count) FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.campaign_id=campaign.id),0) < campaign.total_impression_cap)
    AND CASE WHEN p_session_token IS NULL THEN true ELSE (
      coalesce(frequency.served_count,0)<least(campaign.frequency_cap_per_user_total,5)
      AND (SELECT count(*) FROM catho_private.anonymous_sponsor_events e WHERE e.campaign_id=campaign.id AND e.session_hash=v_hash AND e.event_type='viewable_impression' AND e.received_at>=statement_timestamp()-interval '24 hours') < least(campaign.frequency_cap_per_user_24h,2)
    ) END
    AND NOT campaign.id=ANY(v_campaign_ids)
  ORDER BY (coalesce((SELECT sum(d.viewable_impressions) FROM catho_private.sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date>=v_today-29),0)
      + coalesce((SELECT sum(d.viewable_impressions) FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date>=v_today-29),0))::numeric/campaign.placement_weight ASC,
      pg_catalog.random(),campaign.id
  LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;
  IF NOT FOUND THEN EXIT; END IF;
  IF p_session_token IS NOT NULL THEN
   INSERT INTO catho_private.anonymous_sponsor_events(campaign_id,event_id,session_hash,placement_id,event_type) VALUES(v_campaign.id,gen_random_uuid(),v_hash,p_topic_id,'served');
   INSERT INTO catho_private.anonymous_sponsor_session_frequency(campaign_id,session_hash,served_count,last_served_at)
   VALUES(v_campaign.id,v_hash,1,statement_timestamp())
   ON CONFLICT(campaign_id,session_hash) DO UPDATE SET served_count=catho_private.anonymous_sponsor_session_frequency.served_count+1,last_served_at=EXCLUDED.last_served_at;
  END IF;
  INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,served_count) VALUES(v_today,v_campaign.id,1)
  ON CONFLICT(event_date,campaign_id) DO UPDATE SET served_count=catho_private.anonymous_sponsor_campaign_daily.served_count+1;
  INSERT INTO catho_private.sponsor_campaign_daily(event_date,campaign_id,served_count) VALUES(v_today,v_campaign.id,0)
  ON CONFLICT(event_date,campaign_id) DO NOTHING;
  v_campaign_ids:=pg_catalog.array_append(v_campaign_ids,v_campaign.id);
  v_campaigns:=v_campaigns||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'campaign_id',v_campaign.id,'sponsor_name',v_campaign.sponsor_name,'campaign_name',v_campaign.campaign_name,
   'headline',v_campaign.headline,'body',v_campaign.body,'image_url',v_campaign.image_url,
   'destination_url',v_campaign.destination_url,'cta_label',v_campaign.cta_label,'disclosure','Sponsored'));
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('campaigns',v_campaigns,'generated_at',statement_timestamp());
END; $function$;
ALTER FUNCTION public.get_anonymous_sponsor_campaigns(text, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_anonymous_sponsor_campaigns(text, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_anonymous_sponsor_campaigns(text, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_analytics_consent(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_consent catho_private.user_analytics_consents%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid account for analytics consent lookup' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'serviceImprovement', false,
      'sponsorMeasurement', false,
      'updatedAt', NULL,
      'version', 1,
      'exists', false
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true
  );
END;
$function$;
ALTER FUNCTION public.get_user_analytics_consent(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_user_analytics_consent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_analytics_consent(uuid) TO service_role;

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
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
