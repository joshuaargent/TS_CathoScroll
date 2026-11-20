-- Keep recommendation profiling independent from optional operational analytics.
-- Profiles are rebuilt only from explicit account actions after recommendation consent.
BEGIN;

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

  WITH explicit_events AS (
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
      least(8::numeric,greatest(0::numeric,coalesce(ex.short_score,0))) AS short_score,
      least(8::numeric,greatest(0::numeric,coalesce(ex.long_score,0))) AS long_score,
      least(8::numeric,greatest(0::numeric,coalesce(ex.explicit_score,0))) AS explicit_score,
      0::numeric AS inferred_score,
      0::numeric AS negative_score,
      coalesce(ex.evidence_count,0) AS evidence_count
    FROM public.topics t
    JOIN public.categories c ON c.slug=t.category_slug AND c.is_published=true
    LEFT JOIN explicit_scores ex ON ex.topic_id=t.id
    WHERE t.is_published=true
      AND ex.topic_id IS NOT NULL
  ),
  upserted AS (
    INSERT INTO catho_private.user_topic_interest_scores
      (user_id,topic_id,category_slug,score,positive_score,negative_score,evidence_count,
       short_term_score,long_term_score,explicit_score,inferred_score,model_version,updated_at)
    SELECT p_user_id,topic_id,category_slug,
      greatest(-4::numeric,least(8::numeric,(short_score*0.35)+(long_score*0.65)-negative_score)),
      least(12::numeric,short_score*0.35+long_score*0.65),negative_score,evidence_count,
      short_score,long_score,explicit_score,inferred_score,'2026-11-20-v3-explicit-only',v_now
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

ALTER FUNCTION catho_private.refresh_user_interest_profile(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.refresh_user_interest_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Remove profiles previously influenced by operational analytics. They are rebuilt
-- from explicit account actions the next time the opted-in user requests a feed.
DELETE FROM catho_private.user_topic_interest_scores;

UPDATE catho_private.user_personalization_consents
SET profile_refreshed_at = NULL,
    updated_at = statement_timestamp()
WHERE enabled = true;

COMMIT;
