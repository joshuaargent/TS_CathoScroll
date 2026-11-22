-- EXISTING DATABASE UPGRADE ONLY.
-- Run as one transaction so a failure cannot leave a partial schema or reset.
-- Apply docs/analytics-consent-and-sponsor-opt-out-upgrade.sql first: this
-- upgrade depends on its consent ledger and history tables. It does not create
-- new SQL migration files or alter sponsor measurement. The clean-install
-- equivalent is maintained in docs/cathoscroll-database-bootstrap.sql.

-- Consented, private recommendation personalisation (model 2026-11-20-v4).
BEGIN;

CREATE TABLE IF NOT EXISTS catho_private.user_personalization_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  consent_version text,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  profile_refreshed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT user_personalization_consent_state_check CHECK (
    (enabled AND consent_version IS NOT NULL AND granted_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (NOT enabled AND withdrawn_at IS NOT NULL)
    OR (NOT enabled AND consent_version IS NULL AND granted_at IS NULL AND withdrawn_at IS NULL)
  )
);
CREATE TABLE IF NOT EXISTS catho_private.user_topic_interest_scores (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  category_slug text NOT NULL REFERENCES public.categories(slug) ON DELETE CASCADE,
  score numeric(8,4) NOT NULL DEFAULT 0,
  positive_score numeric(8,4) NOT NULL DEFAULT 0,
  negative_score numeric(8,4) NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  model_version text NOT NULL DEFAULT '2026-11-20-v4',
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  short_term_score numeric(8,4) NOT NULL DEFAULT 0,
  long_term_score numeric(8,4) NOT NULL DEFAULT 0,
  explicit_score numeric(8,4) NOT NULL DEFAULT 0,
  inferred_score numeric(8,4) NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,topic_id),
  CONSTRAINT user_topic_interest_score_bounds CHECK (
    score BETWEEN -4 AND 8 AND positive_score BETWEEN 0 AND 12
    AND negative_score BETWEEN 0 AND 4 AND evidence_count BETWEEN 0 AND 100000
  )
);
CREATE TABLE IF NOT EXISTS catho_private.user_explicit_category_interests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_slug text NOT NULL REFERENCES public.categories(slug) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(user_id,category_slug)
);
CREATE INDEX IF NOT EXISTS user_topic_interest_category_idx
  ON catho_private.user_topic_interest_scores(user_id,category_slug,score DESC);
CREATE INDEX IF NOT EXISTS user_topic_interest_topic_fk_idx
  ON catho_private.user_topic_interest_scores(topic_id);
CREATE INDEX IF NOT EXISTS user_topic_interest_category_fk_idx
  ON catho_private.user_topic_interest_scores(category_slug);
CREATE INDEX IF NOT EXISTS user_explicit_category_interests_category_idx
  ON catho_private.user_explicit_category_interests(category_slug);
ALTER TABLE catho_private.user_personalization_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.user_topic_interest_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.user_explicit_category_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catho_private.user_personalization_consents FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON catho_private.user_topic_interest_scores FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON catho_private.user_explicit_category_interests FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_deep_dive(p_actor_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=p_actor_user_id) THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '180 days'
    OR p_to>statement_timestamp()+interval '1 day' THEN
    RAISE EXCEPTION 'invalid analytics range' USING ERRCODE='22023';
  END IF;

  WITH feed_impressions AS (
    SELECT user_id,session_id,entity_id,received_at
    FROM catho_private.feed_analytics_events
    WHERE event_type='impression' AND metadata->>'source'='feed'
      AND received_at>=p_from AND received_at<p_to
  ),
  feed_topics AS (
    SELECT DISTINCT user_id,session_id,entity_id FROM feed_impressions
  ),
  session_events AS (
    SELECT e.user_id,e.session_id,
      count(*) FILTER(WHERE e.event_type='impression') AS impressions,
      count(*) FILTER(WHERE e.event_type='viewable_impression') AS viewable,
      count(*) FILTER(WHERE e.event_type='completion') AS completions,
      count(*) FILTER(WHERE e.event_type='skip') AS skips,
      count(*) FILTER(WHERE e.event_type='return_visit') AS return_visits,
      coalesce(sum(least(coalesce((e.metadata->>'duration_ms')::integer,0),60000))
        FILTER(WHERE e.event_type='active_duration'),0) AS active_ms
    FROM catho_private.feed_analytics_events e
    JOIN feed_topics t ON t.user_id=e.user_id AND t.session_id=e.session_id AND t.entity_id=e.entity_id
    WHERE e.received_at>=p_from AND e.received_at<p_to
    GROUP BY e.user_id,e.session_id
  ),
  funnel AS (
    SELECT (SELECT count(*) FROM feed_impressions) AS impressions,
      (SELECT count(DISTINCT (e.user_id,e.session_id)) FROM catho_private.feed_analytics_events e
        JOIN feed_topics t ON t.user_id=e.user_id AND t.session_id=e.session_id AND t.entity_id=e.entity_id
        WHERE e.event_type='viewable_impression' AND e.received_at>=p_from AND e.received_at<p_to) AS viewable_sessions,
      (SELECT count(DISTINCT (e.user_id,e.session_id)) FROM catho_private.feed_analytics_events e
        JOIN feed_topics t ON t.user_id=e.user_id AND t.session_id=e.session_id AND t.entity_id=e.entity_id
        WHERE e.event_type='completion' AND e.received_at>=p_from AND e.received_at<p_to) AS completed_sessions,
      (SELECT count(DISTINCT (e.user_id,e.session_id)) FROM catho_private.feed_analytics_events e
        JOIN feed_topics t ON t.user_id=e.user_id AND t.session_id=e.session_id AND t.entity_id=e.entity_id
        WHERE e.event_type='skip' AND e.received_at>=p_from AND e.received_at<p_to) AS skipped_sessions
  ),
  session_summary AS (
    SELECT count(*) AS sessions,
      coalesce(round(avg(impressions),2),0) AS average_topic_impressions,
      coalesce(round(avg(active_ms)::numeric/1000,2),0) AS average_active_seconds,
      coalesce(round(avg(completions),2),0) AS average_completions,
      count(*) FILTER(WHERE active_ms<3000) AS low_engagement_sessions,
      coalesce(sum(return_visits),0) AS return_visits
    FROM session_events
  ),
  first_seen AS (
    SELECT DISTINCT ON (user_id) user_id,received_at AS first_seen_at,session_id AS first_session_id
    FROM catho_private.feed_analytics_events
    WHERE event_type='impression' AND metadata->>'source'='feed'
      AND received_at>=greatest(p_from-interval '180 days',statement_timestamp()-interval '180 days')
      AND received_at<p_to
    ORDER BY user_id,received_at
  ),
  cohorts AS (
    SELECT first_seen_at::date AS cohort_date,count(*) AS users,
      CASE WHEN max(first_seen_at)+interval '7 days'<=p_to THEN
        count(*) FILTER(WHERE EXISTS (
          SELECT 1 FROM catho_private.feed_analytics_events e
          WHERE e.user_id=f.user_id AND e.event_type='impression' AND e.metadata->>'source'='feed'
            AND e.session_id IS DISTINCT FROM f.first_session_id AND e.received_at>f.first_seen_at AND e.received_at<=f.first_seen_at+interval '7 days'
            AND e.received_at<p_to
        )) ELSE NULL END AS returned_7d,
      CASE WHEN max(first_seen_at)+interval '30 days'<=p_to THEN
        count(*) FILTER(WHERE EXISTS (
          SELECT 1 FROM catho_private.feed_analytics_events e
          WHERE e.user_id=f.user_id AND e.event_type='impression' AND e.metadata->>'source'='feed'
            AND e.session_id IS DISTINCT FROM f.first_session_id AND e.received_at>f.first_seen_at AND e.received_at<=f.first_seen_at+interval '30 days'
            AND e.received_at<p_to
        )) ELSE NULL END AS returned_30d
    FROM first_seen f
    WHERE f.first_seen_at>=p_from
    GROUP BY first_seen_at::date
    ORDER BY cohort_date
  ),
  recommendation_summary AS (
    SELECT coalesce(sum(impressions),0) AS impressions,
      coalesce(sum(viewable),0) AS viewable_impressions,
      coalesce(sum(completions),0) AS completions,
      coalesce(sum(skips),0) AS skips,
      coalesce(sum(return_visits),0) AS return_visits,
      coalesce(sum(active_ms),0) AS active_duration_ms
    FROM session_events
  ),
  category_discovery AS (
    SELECT c.slug,c.name,count(DISTINCT t.id) FILTER(WHERE t.is_published) AS published_topics,
      coalesce(sum(d.impressions),0) AS impressions,
      coalesce(sum(d.viewable_impressions),0) AS viewable_impressions,
      coalesce(sum(d.completions),0) AS completions
    FROM public.categories c
    LEFT JOIN public.topics t ON t.category_slug=c.slug AND t.is_published=true
    LEFT JOIN catho_private.feed_analytics_daily d ON d.entity_id=t.id
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    GROUP BY c.slug,c.name
    ORDER BY impressions DESC,c.name
    LIMIT 15
  )
  SELECT jsonb_build_object(
    'funnel',(SELECT to_jsonb(funnel) FROM funnel),
    'sessions',(SELECT to_jsonb(session_summary) FROM session_summary),
    'recommendations',(SELECT to_jsonb(recommendation_summary) FROM recommendation_summary),
    'retention',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'cohort_date',cohort_date,'users',users,'returned_7d',returned_7d,'returned_30d',returned_30d,
      'retention_7d',CASE WHEN returned_7d IS NOT NULL AND users>0 THEN round(returned_7d::numeric*100/users,1) ELSE NULL END,
      'retention_30d',CASE WHEN returned_30d IS NOT NULL AND users>0 THEN round(returned_30d::numeric*100/users,1) ELSE NULL END
    ) ORDER BY cohort_date),'[]'::jsonb) FROM cohorts),
    'categories',(SELECT coalesce(jsonb_agg(to_jsonb(category_discovery)),'[]'::jsonb) FROM category_discovery)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_personalization_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_enabled boolean := false;
  v_updated_at timestamptz;
  v_topics integer := 0;
  v_categories integer := 0;
  v_selected jsonb := '[]'::jsonb;
  v_options jsonb := '[]'::jsonb;
  v_top_topics jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(bool_or(enabled),false),max(updated_at)
    INTO v_enabled,v_updated_at
  FROM catho_private.user_personalization_consents
  WHERE user_id=v_user_id AND consent_version='2026-11-21-v6';
  IF coalesce(v_enabled,false) THEN
    SELECT count(*),count(DISTINCT category_slug) INTO v_topics,v_categories
    FROM (
      SELECT category_slug FROM catho_private.user_topic_interest_scores WHERE user_id=v_user_id
      UNION
      SELECT category_slug FROM catho_private.user_explicit_category_interests WHERE user_id=v_user_id
    ) interests;
    SELECT coalesce(jsonb_agg(category_slug ORDER BY category_slug),'[]'::jsonb)
      INTO v_selected FROM catho_private.user_explicit_category_interests WHERE user_id=v_user_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'topic_id',t.id,'slug',t.slug,'question',t.question,'category_slug',t.category_slug,
      'score',s.score,'short_term_score',s.short_term_score,'long_term_score',s.long_term_score,
      'explicit_score',s.explicit_score,'inferred_score',s.inferred_score
    ) ORDER BY s.score DESC,t.question),'[]'::jsonb)
      INTO v_top_topics
    FROM (
      SELECT * FROM catho_private.user_topic_interest_scores
      WHERE user_id=v_user_id AND score>0
      ORDER BY score DESC,topic_id
      LIMIT 10
    ) s
    JOIN public.topics t ON t.id=s.topic_id AND t.is_published=true;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name) ORDER BY order_index,name),'[]'::jsonb)
    INTO v_options FROM public.categories WHERE is_published=true;
  RETURN jsonb_build_object(
    'enabled',coalesce(v_enabled,false),'updated_at',v_updated_at,
    'topic_interests',v_topics,'category_interests',v_categories,
    'selected_categories',v_selected,'category_options',v_options,
    'top_topic_interests',v_top_topics,'model_version','2026-11-20-v4'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION catho_private.get_user_feed_preference_signals(p_user_id uuid)
 RETURNS TABLE(category_slug text, weight numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_current_user_id uuid := auth.uid();
BEGIN
  IF v_current_user_id IS NULL OR v_current_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Cannot read another account recommendation signals' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM catho_private.user_personalization_consents AS pc
    WHERE pc.user_id = p_user_id
      AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
  ) THEN
    RETURN;
  END IF;
  PERFORM catho_private.refresh_user_interest_profile(p_user_id);
  RETURN QUERY
  SELECT combined.category_slug, sum(combined.weight)::numeric
  FROM (
    SELECT s.category_slug, s.score AS weight
    FROM catho_private.user_topic_interest_scores AS s
    WHERE s.user_id = p_user_id AND s.score <> 0
    UNION ALL
    SELECT e.category_slug, 8::numeric AS weight
    FROM catho_private.user_explicit_category_interests AS e
    WHERE e.user_id = p_user_id
  ) AS combined
  GROUP BY combined.category_slug;
END;
$function$;


ALTER TABLE catho_private.user_topic_interest_scores ALTER COLUMN model_version SET DEFAULT '2026-11-20-v4';

CREATE OR REPLACE FUNCTION catho_private.refresh_user_interest_profile(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
  v_now timestamptz := statement_timestamp();
  v_consent_at timestamptz;
  v_service_consent_at timestamptz;
  v_service_improvement boolean := false;
  v_last_refresh timestamptz;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT c.granted_at,c.profile_refreshed_at,
    coalesce(a.service_improvement,false),a.service_improvement_updated_at
  INTO v_consent_at,v_last_refresh,v_service_improvement,v_service_consent_at
  FROM catho_private.user_personalization_consents c
  LEFT JOIN catho_private.user_analytics_consents a ON a.user_id=c.user_id
  WHERE c.user_id=p_user_id AND c.enabled=true
    AND c.consent_version='2026-11-21-v6';
  IF v_consent_at IS NULL THEN RETURN 0; END IF;
  IF v_last_refresh IS NOT NULL AND v_last_refresh >= v_now-interval '5 minutes' THEN
    SELECT count(*)::integer INTO v_count FROM catho_private.user_topic_interest_scores WHERE user_id=p_user_id;
    RETURN v_count;
  END IF;

  WITH event_scores AS (
    SELECT e.entity_id AS topic_id,
      least(1.20::numeric,coalesce(sum(CASE WHEN e.event_type='viewable_impression'
        THEN 0.40*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='active_duration'
        THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='swipe_depth'
        THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))
        ELSE 0 END),0))
      + least(3.00::numeric,coalesce(sum(CASE WHEN e.event_type='completion'
        THEN 2.50*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='return_visit'
        THEN 0.75*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))
        ELSE 0 END),0)) AS inferred_score,
      least(1.20::numeric,coalesce(sum(CASE WHEN e.event_type='viewable_impression'
        AND e.received_at>=v_now-interval '14 days'
        THEN 0.40*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='active_duration'
        AND e.received_at>=v_now-interval '14 days'
        THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='swipe_depth'
        AND e.received_at>=v_now-interval '14 days'
        THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END),0))
      + least(3.00::numeric,coalesce(sum(CASE WHEN e.event_type='completion'
        AND e.received_at>=v_now-interval '14 days'
        THEN 2.50*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='return_visit'
        AND e.received_at>=v_now-interval '14 days'
        THEN 0.75*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END),0)) AS short_score,
      least(1.20::numeric,coalesce(sum(CASE WHEN e.event_type='viewable_impression'
        THEN 0.40*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='active_duration'
        THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='swipe_depth'
        THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
          *power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))
        ELSE 0 END),0))
      + least(3.00::numeric,coalesce(sum(CASE WHEN e.event_type='completion'
        THEN 2.50*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))
        ELSE 0 END),0))
      + least(1.50::numeric,coalesce(sum(CASE WHEN e.event_type='return_visit'
        THEN 0.75*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))
        ELSE 0 END),0)) AS long_score,
      count(*)::integer AS evidence_count
    FROM catho_private.feed_analytics_events e
    WHERE e.user_id=p_user_id
      AND v_service_improvement IS TRUE
      AND e.received_at>=greatest(v_now-interval '90 days',v_service_consent_at,v_consent_at) AND e.received_at<v_now
      AND e.event_type IN ('viewable_impression','active_duration','swipe_depth','completion','return_visit')
    GROUP BY e.entity_id
  ),
  skip_sessions AS (
    SELECT e.entity_id AS topic_id,e.session_id,
      max(power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))) AS decay
    FROM catho_private.feed_analytics_events e
    WHERE e.user_id=p_user_id AND e.event_type='skip'
      AND v_service_improvement IS TRUE
      AND e.received_at>=greatest(v_now-interval '90 days',v_service_consent_at,v_consent_at) AND e.received_at<v_now
    GROUP BY e.entity_id,e.session_id
  ),
  skip_scores AS (
    SELECT topic_id,count(*)::integer AS skip_sessions,
      least(3::numeric,sum(1.5*decay)) AS negative_score
    FROM skip_sessions GROUP BY topic_id
  ),
  explicit_events AS (
    SELECT p.topic_id,5::numeric AS weight,p.completed_at AS happened_at FROM public.progress p
      WHERE p.user_id=p_user_id AND p.completed_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT b.topic_id,4::numeric,b.created_at FROM public.bookmarks b
      WHERE b.user_id=p_user_id AND b.created_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT l.topic_id,3::numeric,l.created_at FROM public.topic_likes l
      WHERE l.user_id=p_user_id AND l.created_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT c.topic_id,3::numeric,c.created_at FROM public.comments c
      WHERE c.user_id=p_user_id AND c.is_deleted=false AND c.created_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT c.topic_id,3::numeric,cl.created_at FROM public.comment_likes cl
      JOIN public.comments c ON c.id=cl.comment_id
      WHERE cl.user_id=p_user_id AND c.is_deleted=false AND cl.created_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT parent.topic_id,2.5::numeric,reply.created_at FROM public.comments reply
      JOIN public.comments parent ON parent.id=reply.parent_id
      WHERE reply.user_id=p_user_id AND reply.is_deleted=false AND parent.is_deleted=false
        AND reply.created_at>=greatest(v_now-interval '180 days',v_consent_at)
    UNION ALL
    SELECT c.topic_id,
      CASE e.event_type
        WHEN 'viewable_impression' THEN 0.25
        WHEN 'active_duration' THEN least(e.duration_ms,60000)::numeric/60000*0.20
        WHEN 'open' THEN 0.75 ELSE 0 END,
      e.received_at
    FROM catho_private.feed_card_analytics_events e
      JOIN public.comments c ON c.id::text=e.card_id
    WHERE e.user_id=p_user_id AND e.card_type='top-comment'
      AND e.event_type IN ('viewable_impression','active_duration','open')
      AND v_service_improvement IS TRUE
      AND e.received_at>=greatest(v_now-interval '90 days',v_service_consent_at,v_consent_at) AND e.received_at<v_now
  ),
  explicit_scores AS (
    SELECT topic_id,
      sum(weight*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-happened_at))/7776000))) AS explicit_score,
      sum(CASE WHEN happened_at>=v_now-interval '14 days'
        THEN weight*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-happened_at))/1209600))
        ELSE 0 END) AS short_score,
      sum(weight*power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-happened_at))/7776000))) AS long_score,
      count(*)::integer AS evidence_count
    FROM explicit_events GROUP BY topic_id
  ),
  combined AS (
    SELECT t.id AS topic_id,t.category_slug,
      least(8::numeric,greatest(0::numeric,coalesce(es.short_score,0)+coalesce(ex.short_score,0))) AS short_score,
      least(8::numeric,greatest(0::numeric,coalesce(es.long_score,0)+coalesce(ex.long_score,0))) AS long_score,
      least(8::numeric,greatest(0::numeric,coalesce(ex.explicit_score,0))) AS explicit_score,
      least(8::numeric,greatest(0::numeric,coalesce(es.inferred_score,0))) AS inferred_score,
      CASE WHEN coalesce(ss.skip_sessions,0)>=2 THEN least(4::numeric,ss.negative_score) ELSE 0::numeric END AS negative_score,
      coalesce(es.evidence_count,0)+coalesce(ex.evidence_count,0)+coalesce(ss.skip_sessions,0) AS evidence_count
    FROM public.topics t
    JOIN public.categories c ON c.slug=t.category_slug AND c.is_published=true
    LEFT JOIN event_scores es ON es.topic_id=t.id
    LEFT JOIN explicit_scores ex ON ex.topic_id=t.id
    LEFT JOIN skip_scores ss ON ss.topic_id=t.id
    WHERE t.is_published=true
      AND (es.topic_id IS NOT NULL OR ex.topic_id IS NOT NULL OR ss.topic_id IS NOT NULL)
  ),
  upserted AS (
    INSERT INTO catho_private.user_topic_interest_scores
      (user_id,topic_id,category_slug,score,positive_score,negative_score,evidence_count,
       short_term_score,long_term_score,explicit_score,inferred_score,model_version,updated_at)
    SELECT p_user_id,topic_id,category_slug,
      greatest(-4::numeric,least(8::numeric,(short_score*0.35)+(long_score*0.65)-negative_score)),
      least(12::numeric,short_score*0.35+long_score*0.65),negative_score,evidence_count,
      short_score,long_score,explicit_score,inferred_score,'2026-11-20-v4',v_now
    FROM combined
    ON CONFLICT (user_id,topic_id) DO UPDATE SET
      category_slug=EXCLUDED.category_slug,score=EXCLUDED.score,
      positive_score=EXCLUDED.positive_score,negative_score=EXCLUDED.negative_score,
      evidence_count=EXCLUDED.evidence_count,short_term_score=EXCLUDED.short_term_score,
      long_term_score=EXCLUDED.long_term_score,explicit_score=EXCLUDED.explicit_score,
      inferred_score=EXCLUDED.inferred_score,model_version=EXCLUDED.model_version,updated_at=EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM upserted;

  DELETE FROM catho_private.user_topic_interest_scores s
  WHERE s.user_id=p_user_id AND s.updated_at < v_now;
  UPDATE catho_private.user_personalization_consents
  SET profile_refreshed_at=v_now,updated_at=v_now
  WHERE user_id=p_user_id AND enabled=true;
  RETURN v_count;
END;
$function$;



CREATE OR REPLACE FUNCTION public.set_my_personalization_consent(
  p_enabled boolean,
  p_consent_version text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'A consent choice is required' USING ERRCODE='22023'; END IF;
  IF p_enabled IS TRUE AND p_consent_version IS DISTINCT FROM '2026-11-21-v6' THEN
    RAISE EXCEPTION 'Update CathoScroll and review the current personalisation notice before enabling recommendations' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = v_user_id FOR UPDATE;
  IF p_enabled IS TRUE AND NOT EXISTS (
    SELECT 1 FROM catho_private.user_analytics_consents AS consent
    WHERE consent.user_id = v_user_id AND consent.service_improvement IS TRUE
  ) THEN
    RAISE EXCEPTION 'Enable Service improvement analytics before enabling Personalisation'
      USING ERRCODE = '42501';
  END IF;
  IF p_enabled THEN
    INSERT INTO catho_private.user_personalization_consents
      (user_id,enabled,consent_version,granted_at,withdrawn_at,updated_at)
    VALUES (v_user_id,true,'2026-11-21-v6',v_now,NULL,v_now)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled=true,consent_version=EXCLUDED.consent_version,
      granted_at=CASE WHEN catho_private.user_personalization_consents.enabled
        THEN catho_private.user_personalization_consents.granted_at ELSE EXCLUDED.granted_at END,
      withdrawn_at=NULL,
      profile_refreshed_at=CASE WHEN catho_private.user_personalization_consents.enabled THEN catho_private.user_personalization_consents.profile_refreshed_at ELSE NULL END,
      updated_at=EXCLUDED.updated_at;

    PERFORM catho_private.refresh_user_interest_profile(v_user_id);
  ELSE
    INSERT INTO catho_private.user_personalization_consents
      (user_id,enabled,consent_version,granted_at,withdrawn_at,updated_at)
    VALUES(v_user_id,false,'2026-11-21-v6',NULL,v_now,v_now)
    ON CONFLICT(user_id) DO UPDATE SET enabled=false,consent_version='2026-11-21-v6',granted_at=NULL,
      withdrawn_at=EXCLUDED.withdrawn_at,profile_refreshed_at=NULL,updated_at=EXCLUDED.updated_at;
    DELETE FROM catho_private.user_topic_interest_scores WHERE user_id=v_user_id;
    DELETE FROM catho_private.user_explicit_category_interests WHERE user_id=v_user_id;
  END IF;
  RETURN jsonb_build_object('enabled',p_enabled,'updated_at',v_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_personalization_consent(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'A consent choice is required' USING ERRCODE='22023';
  END IF;
  IF p_enabled IS TRUE THEN
    RAISE EXCEPTION 'Update CathoScroll and review the current personalisation notice before enabling recommendations' USING ERRCODE='42501';
  END IF;
  RETURN public.set_my_personalization_consent(false, '2026-11-21-v6');
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_my_personalization_interests(p_category_slugs text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_category_slugs IS NULL OR cardinality(p_category_slugs)>20
    OR EXISTS (SELECT 1 FROM unnest(p_category_slugs) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 100)
    OR (SELECT count(*) FROM unnest(p_category_slugs))<>(SELECT count(DISTINCT x) FROM unnest(p_category_slugs) x) THEN
    RAISE EXCEPTION 'Invalid category interest selection' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.user_personalization_consents c
    WHERE c.user_id=v_user_id AND c.enabled=true
      AND c.consent_version='2026-11-21-v6'
  ) THEN
    RAISE EXCEPTION 'Enable personalisation before saving interests' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_category_slugs) selected(slug)
    WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.slug=selected.slug AND c.is_published=true)
  ) THEN
    RAISE EXCEPTION 'One or more selected categories are unavailable' USING ERRCODE='22023';
  END IF;
  DELETE FROM catho_private.user_explicit_category_interests WHERE user_id=v_user_id;
  INSERT INTO catho_private.user_explicit_category_interests(user_id,category_slug)
  SELECT v_user_id,slug FROM unnest(p_category_slugs) selected(slug);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('selected_categories',v_count);
END;
$function$;


REVOKE ALL ON FUNCTION public.set_my_personalization_consent(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_personalization_status() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_my_personalization_interests(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_consent(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.set_my_personalization_consent(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_consent(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_personalization_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_interests(text[]) TO authenticated;
REVOKE ALL ON FUNCTION catho_private.refresh_user_interest_profile(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION catho_private.get_user_feed_preference_signals(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION catho_private.get_user_feed_preference_signals(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_admin_analytics_deep_dive(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_deep_dive(uuid,timestamptz,timestamptz) TO service_role;


-- Record the optional, explicit personalisation choice made on the shared web/native signup form.
CREATE OR REPLACE FUNCTION catho_private.capture_signup_personalization_consent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_personalization boolean := NEW.raw_user_meta_data ->> 'personalization_consent' = 'true'
    AND NEW.raw_user_meta_data ->> 'personalization_consent_version' = '2026-11-21-v6';
  v_service_improvement boolean := NEW.raw_user_meta_data ->> 'service_improvement_consent' = 'true';
  v_sponsor_measurement boolean := NEW.raw_user_meta_data ->> 'sponsor_measurement_consent' = 'true';
BEGIN
  IF v_personalization IS TRUE AND v_service_improvement IS NOT TRUE THEN
    RAISE EXCEPTION 'Personalisation requires Service improvement analytics'
      USING ERRCODE = '42501';
  END IF;

  -- Personalisation is a separate explicit choice but requires Service
  -- improvement analytics to remain enabled while it is active.
  INSERT INTO catho_private.user_personalization_consents
    (user_id,enabled,consent_version,granted_at,withdrawn_at,updated_at)
  VALUES (
    NEW.id,
    v_personalization,
    '2026-11-21-v6',
    CASE WHEN v_personalization THEN v_now ELSE NULL END,
    CASE WHEN v_personalization THEN NULL ELSE v_now END,
    v_now
  )
  ON CONFLICT(user_id) DO NOTHING;

  -- Service improvement is required while Personalisation is enabled.
  -- Sponsor measurement remains a separate optional choice; each stays off
  -- unless its corresponding unticked signup choice was explicitly selected.
  INSERT INTO catho_private.user_analytics_consents (
      user_id, service_improvement, sponsor_measurement, consent_version,
      service_improvement_updated_at, sponsor_measurement_updated_at, created_at, updated_at
    ) VALUES (
      NEW.id, v_service_improvement, v_sponsor_measurement, 2,
      CASE WHEN v_service_improvement THEN v_now ELSE NULL END,
      CASE WHEN v_sponsor_measurement THEN v_now ELSE NULL END,
      v_now, v_now
    )
    ON CONFLICT (user_id) DO UPDATE SET
      service_improvement = EXCLUDED.service_improvement,
      sponsor_measurement = EXCLUDED.sponsor_measurement,
      service_improvement_updated_at = CASE
        WHEN catho_private.user_analytics_consents.service_improvement IS DISTINCT FROM EXCLUDED.service_improvement
        THEN v_now ELSE catho_private.user_analytics_consents.service_improvement_updated_at END,
      sponsor_measurement_updated_at = CASE
        WHEN catho_private.user_analytics_consents.sponsor_measurement IS DISTINCT FROM EXCLUDED.sponsor_measurement
        THEN v_now ELSE catho_private.user_analytics_consents.sponsor_measurement_updated_at END,
      updated_at = v_now;

    INSERT INTO catho_private.user_analytics_consent_history (
      user_id, previous_service_improvement, previous_sponsor_measurement,
      service_improvement, sponsor_measurement, consent_version, recorded_at
    )
    VALUES (NEW.id, NULL, NULL, v_service_improvement, v_sponsor_measurement, 2, v_now);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION catho_private.capture_signup_personalization_consent() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cathoscroll_capture_signup_personalization_consent ON auth.users;
CREATE TRIGGER cathoscroll_capture_signup_personalization_consent
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION catho_private.capture_signup_personalization_consent();


CREATE TABLE IF NOT EXISTS catho_private.feed_card_analytics_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','viewable_impression','active_duration','skip','completion','open')),
  card_type text NOT NULL CHECK (card_type IN ('top-comment')),
  card_id text NOT NULL CHECK (length(card_id) BETWEEN 1 AND 64),
  session_id uuid NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 300000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=512),
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS feed_card_analytics_events_received_idx ON catho_private.feed_card_analytics_events(received_at);
CREATE INDEX IF NOT EXISTS feed_card_analytics_events_card_received_idx ON catho_private.feed_card_analytics_events(card_type,card_id,received_at DESC);
CREATE TABLE IF NOT EXISTS catho_private.feed_card_analytics_event_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  event_count integer NOT NULL CHECK (event_count BETWEEN 0 AND 120)
);
CREATE TABLE IF NOT EXISTS catho_private.feed_card_analytics_daily (
  event_date date NOT NULL, card_type text NOT NULL, card_id text NOT NULL,
  impressions bigint NOT NULL DEFAULT 0, viewable_impressions bigint NOT NULL DEFAULT 0,
  active_duration_ms bigint NOT NULL DEFAULT 0, skips bigint NOT NULL DEFAULT 0,
  completions bigint NOT NULL DEFAULT 0, opens bigint NOT NULL DEFAULT 0,
  unique_viewers bigint NOT NULL DEFAULT 0, refreshed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(event_date,card_type,card_id)
);
CREATE TABLE IF NOT EXISTS catho_private.feed_card_analytics_daily_viewers (
  event_date date NOT NULL, card_type text NOT NULL, card_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(event_date,card_type,card_id,user_id)
);
CREATE INDEX IF NOT EXISTS feed_card_analytics_daily_card_date_idx ON catho_private.feed_card_analytics_daily(card_type,event_date DESC);
CREATE INDEX IF NOT EXISTS feed_card_analytics_daily_viewers_user_idx ON catho_private.feed_card_analytics_daily_viewers(user_id);
ALTER TABLE catho_private.feed_card_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.feed_card_analytics_event_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.feed_card_analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.feed_card_analytics_daily_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catho_private.feed_card_analytics_events,catho_private.feed_card_analytics_event_limits,
  catho_private.feed_card_analytics_daily,catho_private.feed_card_analytics_daily_viewers
  FROM PUBLIC,anon,authenticated,service_role;

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
CREATE OR REPLACE FUNCTION catho_private.refresh_feed_card_analytics_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rows integer;
begin
  insert into catho_private.feed_card_analytics_daily_viewers(event_date,card_type,card_id,user_id)
  select distinct (received_at at time zone 'UTC')::date,card_type,card_id,user_id
  from catho_private.feed_card_analytics_events
  where received_at >= statement_timestamp()-interval '2 days'
    and event_type in ('impression','viewable_impression')
  on conflict do nothing;
  with event_totals as (
    select (received_at at time zone 'UTC')::date event_date,card_type,card_id,
      count(*) filter(where event_type='impression') impressions,
      count(*) filter(where event_type='viewable_impression') viewable_impressions,
      coalesce(sum(duration_ms) filter(where event_type='active_duration'),0) active_duration_ms,
      count(*) filter(where event_type='skip') skips,
      count(*) filter(where event_type='completion') completions,
      count(*) filter(where event_type='open') opens
    from catho_private.feed_card_analytics_events
    where received_at >= statement_timestamp()-interval '2 days'
    group by 1,2,3
  ), viewer_totals as (
    select event_date,card_type,card_id,count(*) unique_viewers
    from catho_private.feed_card_analytics_daily_viewers
    where event_date >= (statement_timestamp()-interval '2 days')::date
    group by 1,2,3
  )
  insert into catho_private.feed_card_analytics_daily(event_date,card_type,card_id,impressions,viewable_impressions,active_duration_ms,skips,completions,opens,unique_viewers,refreshed_at)
  select e.event_date,e.card_type,e.card_id,e.impressions,e.viewable_impressions,e.active_duration_ms,e.skips,e.completions,e.opens,coalesce(v.unique_viewers,0),statement_timestamp()
  from event_totals e left join viewer_totals v using(event_date,card_type,card_id)
  on conflict(event_date,card_type,card_id) do update set
    impressions=excluded.impressions,viewable_impressions=excluded.viewable_impressions,
    active_duration_ms=excluded.active_duration_ms,skips=excluded.skips,
    completions=excluded.completions,opens=excluded.opens,unique_viewers=excluded.unique_viewers,
    refreshed_at=excluded.refreshed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
ALTER FUNCTION catho_private.refresh_feed_card_analytics_daily() OWNER TO postgres;
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
ALTER FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz,integer) OWNER TO postgres;

-- Recommendation RPC: all account-history weighting is consent-gated.
CREATE OR REPLACE FUNCTION catho_private.get_user_recommendation_category_weights(p_user_id uuid)
 RETURNS TABLE(category_slug text, weight numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_current_user_id uuid := auth.uid();
BEGIN
  IF v_current_user_id IS NULL OR v_current_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Cannot read another account recommendation category weights' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM catho_private.user_personalization_consents AS pc
    WHERE pc.user_id = p_user_id
      AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT signals.category_slug, sum(signals.weight)::numeric
  FROM catho_private.get_user_feed_preference_signals(p_user_id) AS signals
  GROUP BY signals.category_slug;
END;
$function$;

ALTER FUNCTION catho_private.get_user_recommendation_category_weights(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.get_user_recommendation_category_weights(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_recommendation_page(feed_cursor jsonb DEFAULT NULL::jsonb, page_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  state jsonb;
  categories jsonb;
  chosen record;
  items jsonb := '[]'::jsonb;
  last_category text;
  streak integer;
  include_completed boolean;
  personalization_enabled boolean := false;
  personalization_model_version constant text := 'activity-signals-v4';
  initial_page boolean := feed_cursor IS NULL OR feed_cursor = 'null'::jsonb;
  item_count integer := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT catho_private.consume_recommendation_rate_limit(current_user_id) THEN
    RAISE EXCEPTION 'Recommendation rate limit exceeded' USING ERRCODE = 'P0001';
  END IF;

  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 50 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  -- Aggregate form always returns one row; a missing consent row is
  -- explicitly false rather than NULL, so the initial baseline cursor remains valid.
  SELECT coalesce(bool_or(enabled),false) INTO personalization_enabled
  FROM catho_private.user_personalization_consents
  WHERE user_id=current_user_id AND consent_version='2026-11-21-v6';

  IF initial_page THEN
    include_completed := NOT personalization_enabled;
    IF personalization_enabled THEN
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'slug', c.slug,
            'weight', round(1 + sqrt(greatest(coalesce(p.weight, 0), 0)::numeric), 6),
            'served', 0,
            'order', NULL,
            'id', NULL
          ) ORDER BY c.slug
        ),
        '[]'::jsonb
      )
      INTO categories
      FROM public.categories c
      LEFT JOIN catho_private.get_user_recommendation_category_weights(current_user_id) p
        ON p.category_slug = c.slug
      WHERE c.is_published;
    ELSE
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'slug', c.slug,
            'weight', 1,
            'served', 0,
            'order', NULL,
            'id', NULL
          ) ORDER BY c.slug
        ),
        '[]'::jsonb
      )
      INTO categories
      FROM public.categories c
      WHERE c.is_published;
    END IF;

    state := jsonb_build_object(
      'userId', current_user_id,
      'categories', categories,
      'last', NULL,
      'streak', 0,
      'includeCompleted', include_completed,
      'personalizationModelVersion', CASE WHEN personalization_enabled THEN personalization_model_version ELSE NULL END
    );
  ELSE
    state := feed_cursor;
  END IF;

  IF jsonb_typeof(state) IS DISTINCT FROM 'object'
     OR NOT (state ?& ARRAY['userId', 'categories', 'last', 'streak', 'includeCompleted'])
     OR octet_length(state::text) > 65536
     OR state->>'userId' IS DISTINCT FROM current_user_id::text
     OR jsonb_typeof(state->'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(state->'categories') > 200
     OR jsonb_typeof(state->'streak') IS DISTINCT FROM 'number'
     OR coalesce(state->>'streak', '') !~ '^[0-2]$'
     OR jsonb_typeof(state->'includeCompleted') IS DISTINCT FROM 'boolean'
     OR (
       state ? 'personalizationModelVersion'
       AND state->'personalizationModelVersion' <> 'null'::jsonb
       AND (
         jsonb_typeof(state->'personalizationModelVersion') IS DISTINCT FROM 'string'
         OR length(state->>'personalizationModelVersion') > 50
       )
     )
     OR (
       state->'last' <> 'null'::jsonb AND (
         jsonb_typeof(state->'last') IS DISTINCT FROM 'string'
         OR state->>'last' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         OR length(state->>'last') > 100
       )
     ) THEN
    RAISE EXCEPTION 'Invalid recommendation cursor' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(state->'categories') a(entry)
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR NOT (entry ?& ARRAY['slug', 'weight', 'served', 'order', 'id'])
       OR jsonb_typeof(entry->'slug') IS DISTINCT FROM 'string'
       OR entry->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR length(entry->>'slug') > 100
       OR jsonb_typeof(entry->'weight') IS DISTINCT FROM 'number'
       OR length(entry->>'weight') > 40
       OR jsonb_typeof(entry->'served') IS DISTINCT FROM 'number'
       OR coalesce(entry->>'served', '') !~ '^[0-9]{1,9}$'
       OR (entry->'order' = 'null'::jsonb)
          IS DISTINCT FROM (entry->'id' = 'null'::jsonb)
       OR (
         entry->'order' <> 'null'::jsonb AND (
           jsonb_typeof(entry->'order') IS DISTINCT FROM 'number'
           OR coalesce(entry->>'order', '') !~ '^-?[0-9]{1,10}$'
           OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'string'
           OR coalesce(entry->>'id', '') !~ '^[a-zA-Z0-9-]{1,100}$'
         )
       )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(state->'categories') a(entry)
    GROUP BY entry->>'slug'
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(state->'categories') a(entry)
    WHERE (entry->>'weight')::numeric < 1
       OR (entry->>'weight')::numeric > 1000000
       OR (entry->>'order')::numeric < -2147483648
       OR (entry->>'order')::numeric > 2147483647
  ) THEN
    RAISE EXCEPTION 'Invalid recommendation cursor' USING ERRCODE = '22023';
  END IF;

  categories := state->'categories';
  last_category := state->>'last';
  streak := (state->>'streak')::integer;
  include_completed := (state->>'includeCompleted')::boolean;

  IF personalization_enabled
     AND state->>'personalizationModelVersion' IS DISTINCT FROM personalization_model_version THEN
    -- Rebuild weights from explicit account actions, preserving the active cursor's
    -- per-category served counts and keyset positions.
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', c.slug,
          'weight', round(1 + sqrt(greatest(coalesce(p.weight, 0), 0)::numeric), 6),
          'served', coalesce((existing.entry->>'served')::integer, 0),
          'order', coalesce(existing.entry->'order', 'null'::jsonb),
          'id', coalesce(existing.entry->'id', 'null'::jsonb)
        ) ORDER BY c.slug
      ),
      '[]'::jsonb
    )
    INTO categories
    FROM public.categories c
    LEFT JOIN catho_private.get_user_recommendation_category_weights(current_user_id) p
      ON p.category_slug = c.slug
    LEFT JOIN LATERAL (
      SELECT a.entry
      FROM jsonb_array_elements(state->'categories') a(entry)
      WHERE a.entry->>'slug' = c.slug
      LIMIT 1
    ) existing ON true
    WHERE c.is_published;

    state := state || jsonb_build_object(
      'categories', categories,
      'personalizationModelVersion', personalization_model_version
    );
  ELSIF NOT personalization_enabled THEN
    SELECT coalesce(jsonb_agg(a.entry || jsonb_build_object('weight',1) ORDER BY a.ordinality),'[]'::jsonb)
      INTO categories
    FROM jsonb_array_elements(categories) WITH ORDINALITY AS a(entry,ordinality);
    include_completed := true;
    state := state || jsonb_build_object(
      'categories', categories,
      'includeCompleted', true,
      'personalizationModelVersion', NULL
    );
  ELSE
    state := state || jsonb_build_object('personalizationModelVersion', personalization_model_version);
  END IF;

  -- Select the category with the smallest served / weight.
  -- Avoid a third consecutive topic from one category where possible.
  -- Advance only the selected category's indexed keyset.
  WHILE item_count < page_limit LOOP
    SELECT
      a.ordinality::integer - 1 AS position,
      a.entry,
      t.*,
      c.name AS category_name
    INTO chosen
    FROM jsonb_array_elements(categories) WITH ORDINALITY AS a(entry, ordinality)
    JOIN public.categories c
      ON c.slug = a.entry->>'slug' AND c.is_published
    CROSS JOIN LATERAL (
      SELECT t.*
      FROM public.topics t
      WHERE t.category_slug = c.slug
        AND t.is_published
        AND (t.order_index, t.id) >
            (
              coalesce((a.entry->>'order')::integer, -2147483648),
              coalesce(a.entry->>'id', '')
            )
        AND (
          include_completed OR NOT EXISTS (
            SELECT 1
            FROM public.progress p
            WHERE p.user_id = current_user_id AND p.topic_id = t.id
          )
        )
      ORDER BY t.order_index, t.id
      LIMIT 1
    ) t
    ORDER BY
      CASE WHEN streak >= 2 AND c.slug = last_category THEN 1 ELSE 0 END,
      (a.entry->>'served')::numeric / (a.entry->>'weight')::numeric,
      c.slug
    LIMIT 1;

    IF NOT FOUND THEN
      IF initial_page AND item_count = 0 AND NOT include_completed THEN
        include_completed := true;
        CONTINUE;
      END IF;
      EXIT;
    END IF;

    items := items || jsonb_build_array(jsonb_build_object(
      'id', chosen.id,
      'slug', chosen.slug,
      'category', chosen.category_name,
      'question', chosen.question,
      'answer', chosen.answer,
      'explanation', chosen.explanation,
      'catechism', jsonb_build_object(
        'paragraphs', coalesce(chosen.catechism_paragraphs, ARRAY[]::text[]),
        'text', chosen.catechism_text
      ),
      'scripture', jsonb_build_object(
        'reference', chosen.scripture_reference,
        'text', chosen.scripture_text
      )
    ));

    categories := jsonb_set(
      categories,
      ARRAY[chosen.position::text],
      chosen.entry || jsonb_build_object(
        'served', (chosen.entry->>'served')::integer + 1,
        'order', chosen.order_index,
        'id', chosen.id
      )
    );

    IF chosen.category_slug = last_category THEN
      streak := least(streak + 1, 2);
    ELSE
      last_category := chosen.category_slug;
      streak := 1;
    END IF;

    item_count := item_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'topics', items,
    'nextCursor', CASE WHEN item_count = page_limit THEN
      jsonb_build_object(
        'userId', current_user_id,
        'categories', categories,
        'last', last_category,
        'streak', streak,
        'includeCompleted', include_completed,
        'personalizationModelVersion', CASE WHEN personalization_enabled THEN personalization_model_version ELSE NULL END
      )
      ELSE NULL END
  );
END;
$function$;


-- Remove the retired user-membership tier; sponsorship is the only paid offering.
DROP FUNCTION IF EXISTS public.get_own_subscription_tier();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_tier;


-- Match the canonical bootstrap's ownership and least-privilege RPC ACLs.
ALTER FUNCTION public.get_my_recommendation_page(jsonb, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_recommendation_page(jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(jsonb, integer) TO authenticated, service_role;
ALTER FUNCTION public.record_feed_card_analytics_events(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_feed_card_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_card_analytics_events(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION catho_private.refresh_feed_card_analytics_daily() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.refresh_feed_card_analytics_daily() TO service_role;
GRANT EXECUTE ON FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz, integer) TO service_role;


DO $feed_card_analytics_cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cathoscroll-rollup-feed-card-analytics') THEN
    PERFORM cron.schedule(
      'cathoscroll-rollup-feed-card-analytics',
      '*/5 * * * *',
      'SELECT catho_private.refresh_feed_card_analytics_daily();'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cathoscroll-prune-feed-card-analytics') THEN
    PERFORM cron.schedule(
      'cathoscroll-prune-feed-card-analytics',
      '*/15 * * * *',
      'SELECT catho_private.prune_feed_card_analytics_events(statement_timestamp() - interval ''180 days'', 5000);'
    );
  END IF;
END;
$feed_card_analytics_cron$;


-- The one-time profile and analytics reset is performed at the end of this
-- script under a durable marker, so rerunning the upgrade preserves new data.

-- Personalisation is now a separate choice. Existing v3 opt-ins must be
-- re-confirmed against the updated purpose wording before recommendations resume.
DO $personalization_consent_regrant$
DECLARE
  v_affected_user_ids uuid[];
  v_now timestamptz := statement_timestamp();
BEGIN
  SELECT coalesce(array_agg(c.user_id), ARRAY[]::uuid[])
  INTO v_affected_user_ids
  FROM catho_private.user_personalization_consents AS c
  WHERE c.enabled = true
    AND (
      c.consent_version IS DISTINCT FROM '2026-11-21-v6'
    );

  UPDATE catho_private.user_personalization_consents
  SET enabled = false,
      consent_version = NULL,
      granted_at = NULL,
      withdrawn_at = v_now,
      profile_refreshed_at = NULL,
      updated_at = v_now
  WHERE user_id = ANY(v_affected_user_ids);

  DELETE FROM catho_private.user_topic_interest_scores
  WHERE user_id = ANY(v_affected_user_ids);
  DELETE FROM catho_private.user_explicit_category_interests
  WHERE user_id = ANY(v_affected_user_ids);

  DELETE FROM catho_private.user_topic_interest_scores AS s
  WHERE NOT EXISTS (
    SELECT 1
    FROM catho_private.user_personalization_consents AS c
    WHERE c.user_id = s.user_id
      AND c.enabled = true
      AND c.consent_version = '2026-11-21-v6'
  );
  DELETE FROM catho_private.user_explicit_category_interests AS i
  WHERE NOT EXISTS (
    SELECT 1
    FROM catho_private.user_personalization_consents AS c
    WHERE c.user_id = i.user_id
      AND c.enabled = true
      AND c.consent_version = '2026-11-21-v6'
  );
END;
$personalization_consent_regrant$;


-- Release-wide analytics and personalisation reset.
-- No existing account has an active choice under the new disclosures.
-- Deleting current-state rows makes the choice genuinely unset (not a
-- A missing row is the not-yet-decided state, not a recorded refusal.
-- recorded refusal). Historical consent evidence remains in the audit table,
-- but it is never consulted as current permission and cannot authorize new
-- processing under this release.
--
-- Clear all old engagement measurements and derived analytics so the new
-- dashboards start from zero. Product data (likes, bookmarks, progress,
-- comments, notes and account activity) is deliberately untouched.
--
-- A durable marker makes the reset safe to rerun: subsequent executions
-- leave choices and analytics collected after the reset untouched.
CREATE TABLE IF NOT EXISTS catho_private.analytics_release_resets (
  reset_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE catho_private.analytics_release_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catho_private.analytics_release_resets FROM PUBLIC, anon, authenticated, service_role;

-- Lock both consent ledgers and remove current grants first. Event ingestion
-- functions take row-share locks on these rows, so once this transaction
-- commits, old grants cannot write into the freshly cleared analytics tables.
LOCK TABLE catho_private.user_analytics_consents,
           catho_private.user_personalization_consents
  IN ACCESS EXCLUSIVE MODE;

DO $release_analytics_reset$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.analytics_release_resets
    WHERE reset_key = '2026-11-21-no-anonymous-analytics-v1'
  ) THEN
    DELETE FROM catho_private.user_analytics_consents;
    DELETE FROM catho_private.user_personalization_consents;

    DELETE FROM catho_private.sponsor_campaign_placement_receipts;
    DELETE FROM catho_private.sponsor_campaign_events;
    DELETE FROM catho_private.sponsor_campaign_daily;

    DELETE FROM catho_private.feed_card_analytics_events;
    DELETE FROM catho_private.feed_card_analytics_event_limits;
    DELETE FROM catho_private.feed_card_analytics_daily_viewers;
    DELETE FROM catho_private.feed_card_analytics_daily;

    DELETE FROM catho_private.feed_analytics_events;
    DELETE FROM catho_private.feed_analytics_event_limits;
    DELETE FROM catho_private.feed_analytics_daily_viewers;
    DELETE FROM catho_private.feed_analytics_daily;

    -- Remove every derived or explicitly selected personalisation record.
    -- Account actions remain product records, but the new profile's grant
    -- timestamp prevents pre-consent actions entering the fresh profile.
    DELETE FROM catho_private.user_topic_interest_scores;
    DELETE FROM catho_private.user_explicit_category_interests;

    INSERT INTO catho_private.analytics_release_resets(reset_key)
    VALUES ('2026-11-21-no-anonymous-analytics-v1');
  END IF;
END;
$release_analytics_reset$;

NOTIFY pgrst, 'reload schema';
COMMIT;
