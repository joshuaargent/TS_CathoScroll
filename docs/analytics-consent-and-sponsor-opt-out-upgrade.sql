-- CathoScroll optional analytics consent and sponsor-measurement opt-out.
-- Apply only after validating this migration on both a clean bootstrap and an
-- existing CathoScroll database. It preserves sponsor delivery and campaign/day
-- served totals when a visitor declines sponsor measurement.
-- This migration is idempotent and does not rewrite existing analytics events.

BEGIN;

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
  WHERE consent.user_id = p_user_id;
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
      ON frequency.campaign_id = campaign.id AND frequency.user_id = p_user_id
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
      AND (v_session_id IS NULL OR (
        coalesce(frequency.served_count, 0) < campaign.frequency_cap_per_user_total
        AND (SELECT pg_catalog.count(*) FROM catho_private.sponsor_campaign_events AS recent_viewable
          WHERE recent_viewable.user_id = p_user_id AND recent_viewable.campaign_id = campaign.id
            AND recent_viewable.event_type = 'viewable_impression'
            AND recent_viewable.received_at >= pg_catalog.statement_timestamp() - interval '24 hours')
          < campaign.frequency_cap_per_user_24h
      ))
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
  LEFT JOIN catho_private.anonymous_sponsor_session_frequency frequency ON frequency.campaign_id=campaign.id AND frequency.session_hash=v_hash
  WHERE campaign.status='approved' AND sponsor.status IN ('active','scheduled')
    AND (sponsor.starts_on IS NULL OR sponsor.starts_on<=v_today) AND (sponsor.ends_on IS NULL OR sponsor.ends_on>=v_today)
    AND sponsor.payment_status IN ('received','not_required')
    AND campaign.starts_on<=v_today AND campaign.ends_on>=v_today
    AND (cardinality(campaign.target_category_slugs)=0 OR v_topic_category_slug=ANY(campaign.target_category_slugs))
    AND (cardinality(campaign.target_topic_ids)=0 OR (p_topic_id IS NOT NULL AND p_topic_id=ANY(campaign.target_topic_ids)))
    AND (campaign.daily_impression_cap IS NULL OR coalesce((SELECT d.served_count FROM catho_private.sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date=v_today),0)
      + coalesce((SELECT d.served_count FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.campaign_id=campaign.id AND d.event_date=v_today),0) < campaign.daily_impression_cap)
    AND (campaign.total_impression_cap IS NULL OR campaign.served_count + coalesce((SELECT sum(d.served_count) FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.campaign_id=campaign.id),0) < campaign.total_impression_cap)
    AND (p_session_token IS NULL OR (
      coalesce(frequency.served_count,0)<least(campaign.frequency_cap_per_user_total,5)
      AND (SELECT count(*) FROM catho_private.anonymous_sponsor_events e WHERE e.campaign_id=campaign.id AND e.session_hash=v_hash AND e.event_type='viewable_impression' AND e.received_at>=statement_timestamp()-interval '24 hours') < least(campaign.frequency_cap_per_user_24h,2)
    ))
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
COMMIT;
