-- Consented, private recommendation personalisation (model 2026-11-19-v2).
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
  model_version text NOT NULL DEFAULT '2026-11-19-v1',
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
  SELECT enabled,updated_at INTO v_enabled,v_updated_at
  FROM catho_private.user_personalization_consents WHERE user_id=v_user_id;
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
    'top_topic_interests',v_top_topics,'model_version','2026-11-19-v2'
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
  IF NOT EXISTS (SELECT 1 FROM catho_private.user_personalization_consents c
    WHERE c.user_id=p_user_id AND c.enabled=true) THEN RETURN; END IF;
  PERFORM catho_private.refresh_user_interest_profile(p_user_id);
  RETURN QUERY
  SELECT combined.category_slug,sum(combined.weight)::numeric
  FROM (
    SELECT s.category_slug,s.score AS weight
    FROM catho_private.user_topic_interest_scores s
    WHERE s.user_id=p_user_id AND s.score<>0
    UNION ALL
    SELECT e.category_slug,8::numeric AS weight
    FROM catho_private.user_explicit_category_interests e
    WHERE e.user_id=p_user_id
  ) combined
  GROUP BY combined.category_slug;
END;
$function$;


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
  v_last_refresh timestamptz;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT c.granted_at,c.profile_refreshed_at INTO v_consent_at,v_last_refresh
  FROM catho_private.user_personalization_consents c
  WHERE c.user_id=p_user_id AND c.enabled=true;
  IF v_consent_at IS NULL THEN RETURN 0; END IF;
  IF v_last_refresh IS NOT NULL AND v_last_refresh >= v_now-interval '5 minutes' THEN
    SELECT count(*)::integer INTO v_count FROM catho_private.user_topic_interest_scores WHERE user_id=p_user_id;
    RETURN v_count;
  END IF;

  WITH event_scores AS (
    SELECT e.entity_id AS topic_id,
      sum(CASE e.event_type
        WHEN 'viewable_impression' THEN 0.40
        WHEN 'active_duration' THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
        WHEN 'swipe_depth' THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
        WHEN 'completion' THEN 2.50
        WHEN 'return_visit' THEN 0.75
        ELSE 0 END * power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))) AS inferred_score,
      sum(CASE WHEN e.received_at >= v_now-interval '14 days' THEN
        CASE e.event_type
          WHEN 'viewable_impression' THEN 0.40
          WHEN 'active_duration' THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
          WHEN 'swipe_depth' THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
          WHEN 'completion' THEN 2.50
          WHEN 'return_visit' THEN 0.75 ELSE 0 END
        * power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/1209600))
        ELSE 0 END) AS short_score,
      sum(CASE e.event_type
        WHEN 'viewable_impression' THEN 0.40
        WHEN 'active_duration' THEN least(coalesce((e.metadata->>'duration_ms')::numeric,0),60000)/60000*0.25
        WHEN 'swipe_depth' THEN least(coalesce((e.metadata->>'depth')::numeric,0),4)/4*0.50
        WHEN 'completion' THEN 2.50
        WHEN 'return_visit' THEN 0.75 ELSE 0 END
        * power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/7776000))) AS long_score,
      count(*)::integer AS evidence_count
    FROM catho_private.feed_analytics_events e
    WHERE e.user_id=p_user_id
      AND e.received_at>=greatest(v_now-interval '90 days',v_consent_at) AND e.received_at<v_now
      AND e.event_type IN ('viewable_impression','active_duration','swipe_depth','completion','return_visit')
    GROUP BY e.entity_id
  ),
  skip_sessions AS (
    SELECT e.entity_id AS topic_id,e.session_id,
      max(power(0.5::numeric,greatest(0,extract(epoch FROM (v_now-e.received_at))/2592000))) AS decay
    FROM catho_private.feed_analytics_events e
    WHERE e.user_id=p_user_id AND e.event_type='skip'
      AND e.received_at>=greatest(v_now-interval '90 days',v_consent_at) AND e.received_at<v_now
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
      AND e.received_at>=greatest(v_now-interval '90 days',v_consent_at) AND e.received_at<v_now
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
      short_score,long_score,explicit_score,inferred_score,'2026-11-19-v2',v_now
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


CREATE OR REPLACE FUNCTION public.set_my_personalization_consent(p_enabled boolean)
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
  IF p_enabled THEN
    INSERT INTO catho_private.user_personalization_consents
      (user_id,enabled,consent_version,granted_at,withdrawn_at,updated_at)
    VALUES (v_user_id,true,'2026-11-19-v3',v_now,NULL,v_now)
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
    VALUES(v_user_id,false,NULL,NULL,v_now,v_now)
    ON CONFLICT(user_id) DO UPDATE SET enabled=false,consent_version=NULL,granted_at=NULL,
      withdrawn_at=EXCLUDED.withdrawn_at,profile_refreshed_at=NULL,updated_at=EXCLUDED.updated_at;
    DELETE FROM catho_private.user_topic_interest_scores WHERE user_id=v_user_id;
    DELETE FROM catho_private.user_explicit_category_interests WHERE user_id=v_user_id;
  END IF;
  RETURN jsonb_build_object('enabled',p_enabled,'updated_at',v_now);
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


REVOKE ALL ON FUNCTION public.set_my_personalization_consent(boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_personalization_status() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_my_personalization_interests(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_consent(boolean) TO authenticated;
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
BEGIN
  IF NEW.raw_user_meta_data ->> 'personalization_consent' = 'true' THEN
    INSERT INTO catho_private.user_personalization_consents
      (user_id,enabled,consent_version,granted_at,withdrawn_at,updated_at)
    VALUES
      (NEW.id,true,'2026-11-19-v3',statement_timestamp(),NULL,statement_timestamp())
    ON CONFLICT(user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION catho_private.capture_signup_personalization_consent() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cathoscroll_capture_signup_personalization_consent ON auth.users;
CREATE TRIGGER cathoscroll_capture_signup_personalization_consent
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION catho_private.capture_signup_personalization_consent();


-- Recommendation RPC: all account-history weighting is consent-gated.
CREATE OR REPLACE FUNCTION public.get_my_recommendation_page(feed_cursor jsonb DEFAULT NULL::jsonb, page_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
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

  SELECT coalesce(enabled,false) INTO personalization_enabled
  FROM catho_private.user_personalization_consents
  WHERE user_id=current_user_id;

  IF initial_page THEN
    include_completed := NOT personalization_enabled;
    -- Freeze category preferences for this feed cursor. Legacy learning actions
    -- remain strong signals; feed telemetry adds bounded, decaying evidence.
    WITH signals AS (
      SELECT p.topic_id, 5::numeric AS weight
      FROM public.progress p
      WHERE p.user_id = current_user_id

      UNION ALL

      SELECT b.topic_id, 4::numeric
      FROM public.bookmarks b
      WHERE b.user_id = current_user_id

      UNION ALL

      SELECT l.topic_id, 3::numeric
      FROM public.topic_likes l
      WHERE l.user_id = current_user_id

      UNION ALL

      SELECT DISTINCT c.topic_id, 3::numeric
      FROM public.comments c
      WHERE c.user_id = current_user_id
        AND c.is_deleted = false
    ),
    legacy_preferences AS (
      SELECT t.category_slug, sum(s.weight) AS weight
      FROM signals s
      JOIN public.topics t
        ON t.id = s.topic_id AND t.is_published
      JOIN public.categories c
        ON c.slug = t.category_slug AND c.is_published
      WHERE personalization_enabled
      GROUP BY t.category_slug
    ),
    feed_preferences AS (
      SELECT feed_signals.category_slug, sum(feed_signals.weight) AS weight
      FROM catho_private.get_user_feed_preference_signals(current_user_id) AS feed_signals
      WHERE personalization_enabled
      GROUP BY feed_signals.category_slug
    ),
    preferences AS (
      SELECT category_slug, weight FROM legacy_preferences
      UNION ALL
      SELECT category_slug, weight FROM feed_preferences
    )
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
    LEFT JOIN (
      SELECT category_slug, sum(weight) AS weight
      FROM preferences
      GROUP BY category_slug
    ) p ON p.category_slug = c.slug
    WHERE c.is_published;

    state := jsonb_build_object(
      'userId', current_user_id,
      'categories', categories,
      'last', NULL,
      'streak', 0,
      'includeCompleted', false
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

  IF NOT personalization_enabled THEN
    SELECT coalesce(jsonb_agg(a.entry || jsonb_build_object('weight',1) ORDER BY a.ordinality),'[]'::jsonb)
      INTO categories
    FROM jsonb_array_elements(categories) WITH ORDINALITY AS a(entry,ordinality);
    include_completed := true;
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
        'includeCompleted', include_completed
      )
      ELSE NULL END
  );
END;
$function$;


-- Remove the retired user-membership tier; sponsorship is the only paid offering.
DROP FUNCTION IF EXISTS public.get_own_subscription_tier();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_tier;
