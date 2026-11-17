-- Phase 2: run only after the logo-free application version is deployed.
-- The old 14-argument RPC and logo column are no longer needed.

DROP FUNCTION IF EXISTS public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text);

CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(
  p_user_id uuid, p_session_id uuid, p_category_slug text DEFAULT NULL,
  p_topic_id text DEFAULT NULL, p_limit integer DEFAULT 5
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_slot integer;
  v_today date := (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign request' USING ERRCODE = '22023';
  END IF;
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
        OR (p_category_slug IS NOT NULL AND p_category_slug = ANY(campaign.target_category_slugs)))
      AND (cardinality(campaign.target_topic_ids) = 0
        OR (p_topic_id IS NOT NULL AND p_topic_id = ANY(campaign.target_topic_ids)))
      AND (campaign.daily_impression_cap IS NULL OR coalesce((
        SELECT daily.served_count FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today
      ), 0) < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR campaign.served_count < campaign.total_impression_cap)
      AND coalesce(frequency.served_count, 0) < campaign.frequency_cap_per_user_total
      AND (SELECT pg_catalog.count(*) FROM catho_private.sponsor_campaign_events AS recent_served
        WHERE recent_served.user_id = p_user_id AND recent_served.campaign_id = campaign.id
          AND recent_served.event_type = 'served'
          AND recent_served.received_at >= pg_catalog.statement_timestamp() - interval '24 hours')
        < campaign.frequency_cap_per_user_24h
      AND NOT (campaign.id = ANY(v_campaign_ids))
    ORDER BY
      coalesce((SELECT pg_catalog.sum(daily.viewable_impressions)::numeric
        FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
          AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0)
        / campaign.placement_weight::numeric ASC,
      pg_catalog.random(), campaign.id
    LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;

    IF NOT FOUND THEN EXIT; END IF;

    UPDATE public.sponsor_campaigns SET served_count=served_count+1, updated_at=pg_catalog.statement_timestamp()
    WHERE id=v_campaign.id;

    INSERT INTO catho_private.sponsor_campaign_events
      (campaign_id,event_id,user_id,session_id,event_type,received_at)
    VALUES (v_campaign.id,pg_catalog.gen_random_uuid(),p_user_id,p_session_id,'served',pg_catalog.statement_timestamp());

    INSERT INTO catho_private.sponsor_campaign_user_frequency
      (campaign_id,user_id,served_count,last_served_at)
    VALUES (v_campaign.id,p_user_id,1,pg_catalog.statement_timestamp())
    ON CONFLICT (campaign_id,user_id) DO UPDATE
    SET served_count=catho_private.sponsor_campaign_user_frequency.served_count+1,
      last_served_at=EXCLUDED.last_served_at;

    INSERT INTO catho_private.sponsor_campaign_daily
      (event_date,campaign_id,served_count,viewable_impressions,clicks,updated_at)
    VALUES (v_today,v_campaign.id,1,0,0,pg_catalog.statement_timestamp())
    ON CONFLICT (event_date,campaign_id) DO UPDATE
    SET served_count=catho_private.sponsor_campaign_daily.served_count+1,updated_at=EXCLUDED.updated_at;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids,v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id',v_campaign.id,'sponsor_name',v_campaign.sponsor_name,
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
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

ALTER TABLE public.sponsors DROP COLUMN IF EXISTS logo_url;

NOTIFY pgrst, 'reload schema';
