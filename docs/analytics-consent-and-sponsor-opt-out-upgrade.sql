-- CathoScroll optional analytics consent and sponsor-measurement opt-out.
-- Apply only after validating this migration on both a clean bootstrap and an
-- existing CathoScroll database. Sponsor delivery and campaign/day served totals
-- continue when measurement is declined; no session/user frequency records or
-- viewability/click events are written for opted-out placements.
-- Idempotent. Existing analytics event rows and aggregate history are preserved.

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
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.user_analytics_consents AS consent
    WHERE consent.user_id = v_user_id AND consent.service_improvement = true
  ) THEN RETURN 0; END IF;
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

CREATE OR REPLACE FUNCTION public.get_admin_content_analytics(p_entity_type text, p_entity_id text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_first_retained_event_at timestamptz;
  v_effective_from timestamptz;
  v_topic_ids text[];
  v_event_metrics jsonb;
  v_depth_metrics jsonb;
  v_interactions jsonb;
  v_series jsonb;
  v_last_event_at timestamptz;
  v_category_content jsonb;
  v_top_topics jsonb := '[]'::jsonb;
  v_rollup_from date;
  v_rollup_to date;
BEGIN
  IF p_entity_type IS NULL OR p_entity_type NOT IN ('topic', 'category')
     OR p_entity_id IS NULL OR pg_catalog.length(p_entity_id) < 1 OR pg_catalog.length(p_entity_id) > 150
     OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from
     OR p_to > pg_catalog.statement_timestamp() + interval '1 day'
     OR p_to - p_from > interval '180 days' THEN
    RAISE EXCEPTION 'Invalid analytics query parameters' USING ERRCODE = '22023';
  END IF;

  IF p_entity_type = 'topic' THEN
    SELECT pg_catalog.array_agg(t.id) INTO v_topic_ids
    FROM public.topics AS t WHERE t.slug = p_entity_id;
    IF v_topic_ids IS NULL THEN
      RAISE EXCEPTION 'Analytics entity not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.categories AS c WHERE c.slug = p_entity_id) THEN
      RAISE EXCEPTION 'Analytics entity not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT coalesce(pg_catalog.array_agg(t.id), ARRAY[]::text[]) INTO v_topic_ids
    FROM public.topics AS t WHERE t.category_slug = p_entity_id;
  END IF;

  SELECT pg_catalog.min(e.received_at)
  INTO v_first_retained_event_at
  FROM catho_private.feed_analytics_events AS e;

  v_effective_from := greatest(p_from, coalesce(v_first_retained_event_at, p_to));
  v_rollup_from := (v_effective_from AT TIME ZONE 'UTC')::date
    + CASE WHEN (v_effective_from AT TIME ZONE 'UTC')::time = time '00:00:00'
      THEN 0 ELSE 1 END;
  v_rollup_to := (p_to AT TIME ZONE 'UTC')::date;

  SELECT pg_catalog.max(e.received_at)
  INTO v_last_event_at
  FROM catho_private.feed_analytics_events AS e
  WHERE e.entity_type = 'topic' AND e.entity_id = ANY(v_topic_ids)
    AND e.received_at >= coalesce(v_first_retained_event_at, p_to)
    AND e.received_at < pg_catalog.statement_timestamp();

  SELECT pg_catalog.jsonb_build_object(
    'impressions', coalesce(rollup.impressions, 0) + coalesce(recent.impressions, 0),
    'viewable_impressions', coalesce(rollup.viewable_impressions, 0) + coalesce(recent.viewable_impressions, 0),
    'unique_viewers', (
      SELECT pg_catalog.count(DISTINCT viewer.user_id)
      FROM (
        SELECT daily_viewer.user_id
        FROM catho_private.feed_analytics_daily_viewers AS daily_viewer
        WHERE daily_viewer.entity_id = ANY(v_topic_ids)
          AND daily_viewer.event_date >= v_rollup_from
          AND daily_viewer.event_date < v_rollup_to
        UNION
        SELECT raw_event.user_id
        FROM catho_private.feed_analytics_events AS raw_event
        WHERE raw_event.entity_type = 'topic'
          AND raw_event.entity_id = ANY(v_topic_ids)
          AND raw_event.event_type = 'viewable_impression'
          AND raw_event.received_at >= v_effective_from
          AND raw_event.received_at < p_to
          AND NOT (
            raw_event.received_at >= (v_rollup_from::timestamp AT TIME ZONE 'UTC')
            AND raw_event.received_at < (v_rollup_to::timestamp AT TIME ZONE 'UTC')
          )
      ) AS viewer
    ),
    'active_seconds', pg_catalog.round(
      (coalesce(rollup.active_duration_ms, 0) + coalesce(recent.active_duration_ms, 0)) / 1000.0, 1),
    'skips', coalesce(rollup.skips, 0) + coalesce(recent.skips, 0),
    'completions', coalesce(rollup.completions, 0) + coalesce(recent.completions, 0),
    'return_visits', coalesce(rollup.return_visits, 0) + coalesce(recent.return_visits, 0)
  )
  INTO v_event_metrics
  FROM (
    SELECT
      coalesce(sum(daily.impressions), 0) AS impressions,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.active_duration_ms), 0) AS active_duration_ms,
      coalesce(sum(daily.skips), 0) AS skips,
      coalesce(sum(daily.completions), 0) AS completions,
      coalesce(sum(daily.return_visits), 0) AS return_visits
    FROM catho_private.feed_analytics_daily AS daily
    WHERE daily.entity_id = ANY(v_topic_ids)
      AND daily.event_date >= v_rollup_from
      AND daily.event_date < v_rollup_to
  ) AS rollup
  CROSS JOIN (
    SELECT
      count(*) FILTER (WHERE raw_event.event_type = 'impression') AS impressions,
      count(*) FILTER (WHERE raw_event.event_type = 'viewable_impression') AS viewable_impressions,
      coalesce(sum((raw_event.metadata ->> 'duration_ms')::numeric)
        FILTER (WHERE raw_event.event_type = 'active_duration'), 0) AS active_duration_ms,
      count(*) FILTER (WHERE raw_event.event_type = 'skip') AS skips,
      count(*) FILTER (WHERE raw_event.event_type = 'completion') AS completions,
      count(*) FILTER (WHERE raw_event.event_type = 'return_visit') AS return_visits
    FROM catho_private.feed_analytics_events AS raw_event
    WHERE raw_event.entity_type = 'topic'
      AND raw_event.entity_id = ANY(v_topic_ids)
      AND raw_event.received_at >= v_effective_from
      AND raw_event.received_at < p_to
      AND NOT (
        raw_event.received_at >= (v_rollup_from::timestamp AT TIME ZONE 'UTC')
        AND raw_event.received_at < (v_rollup_to::timestamp AT TIME ZONE 'UTC')
      )
  ) AS recent;

  SELECT pg_catalog.jsonb_build_object(
    'average_slide_depth',
      pg_catalog.round(coalesce(pg_catalog.avg(coalesce(visits.max_depth, 0)), 0), 2),
    'average_completion_percent',
      pg_catalog.round(coalesce(pg_catalog.avg(coalesce(visits.max_depth, 0) / 4 * 100), 0), 1)
  )
  INTO v_depth_metrics
  FROM (
    SELECT
      impressions.user_id,
      impressions.session_id,
      impressions.entity_id,
      pg_catalog.max((depth.metadata ->> 'depth')::numeric) AS max_depth
    FROM (
      SELECT DISTINCT e.user_id, e.session_id, e.entity_id
      FROM catho_private.feed_analytics_events AS e
      WHERE e.entity_type = 'topic'
        AND e.entity_id = ANY(v_topic_ids)
        AND e.event_type = 'impression'
        AND e.received_at >= v_effective_from
        AND e.received_at < p_to
    ) AS impressions
    LEFT JOIN catho_private.feed_analytics_events AS depth
      ON depth.user_id = impressions.user_id
     AND depth.session_id = impressions.session_id
     AND depth.entity_type = 'topic'
     AND depth.entity_id = impressions.entity_id
     AND depth.event_type = 'swipe_depth'
     AND depth.received_at >= v_effective_from
     AND depth.received_at < p_to
    GROUP BY impressions.user_id, impressions.session_id, impressions.entity_id
  ) AS visits;

  v_event_metrics := v_event_metrics || v_depth_metrics;

  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'date', pg_catalog.to_char(days.day, 'YYYY-MM-DD'),
        'impressions', coalesce(daily.impressions, 0),
        'viewable_impressions', coalesce(daily.viewable_impressions, 0),
        'unique_viewers', coalesce(daily.unique_viewers, 0),
        'active_seconds', coalesce(daily.active_seconds, 0)
      ) ORDER BY days.day
    ), '[]'::jsonb
  )
  INTO v_series
  FROM pg_catalog.generate_series(
    pg_catalog.date_trunc('day', v_effective_from AT TIME ZONE 'UTC'),
    pg_catalog.date_trunc('day', (p_to - interval '1 microsecond') AT TIME ZONE 'UTC'),
    interval '1 day'
  ) AS days(day)
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(part.impressions), 0) AS impressions,
      coalesce(sum(part.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(part.unique_viewers), 0) AS unique_viewers,
      pg_catalog.round(coalesce(sum(part.active_duration_ms), 0) / 1000.0, 1) AS active_seconds
    FROM (
      SELECT
        count(*) FILTER (WHERE raw_event.event_type = 'impression') AS impressions,
        count(*) FILTER (WHERE raw_event.event_type = 'viewable_impression') AS viewable_impressions,
        count(DISTINCT raw_event.user_id) FILTER (WHERE raw_event.event_type = 'viewable_impression') AS unique_viewers,
        coalesce(sum((raw_event.metadata ->> 'duration_ms')::numeric)
          FILTER (WHERE raw_event.event_type = 'active_duration'), 0) AS active_duration_ms
      FROM catho_private.feed_analytics_events AS raw_event
      WHERE raw_event.entity_type = 'topic'
        AND raw_event.entity_id = ANY(v_topic_ids)
        AND raw_event.received_at >= greatest(days.day AT TIME ZONE 'UTC', v_effective_from)
        AND raw_event.received_at < least((days.day + interval '1 day') AT TIME ZONE 'UTC', p_to)
        AND NOT (days.day::date >= v_rollup_from AND days.day::date < v_rollup_to)
      UNION ALL
      SELECT
        coalesce(sum(daily_row.impressions), 0),
        coalesce(sum(daily_row.viewable_impressions), 0),
        (
          SELECT pg_catalog.count(*)
          FROM catho_private.feed_analytics_daily_viewers AS viewer_row
          WHERE viewer_row.entity_id = ANY(v_topic_ids)
            AND viewer_row.event_date = days.day::date
        ),
        coalesce(sum(daily_row.active_duration_ms), 0)
      FROM catho_private.feed_analytics_daily AS daily_row
      WHERE daily_row.entity_id = ANY(v_topic_ids)
        AND daily_row.event_date = days.day::date
        AND days.day::date >= v_rollup_from
        AND days.day::date < v_rollup_to
    ) AS part
  ) AS daily ON true;

  SELECT pg_catalog.jsonb_build_object(
    'period', pg_catalog.jsonb_build_object(
      'likes', (SELECT pg_catalog.count(*) FROM public.topic_likes l WHERE l.topic_id = ANY(v_topic_ids) AND l.created_at >= p_from AND l.created_at < p_to),
      'bookmarks', (SELECT pg_catalog.count(*) FROM public.bookmarks b WHERE b.topic_id = ANY(v_topic_ids) AND b.created_at >= p_from AND b.created_at < p_to),
      'comments', (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = ANY(v_topic_ids) AND c.parent_id IS NULL AND c.is_deleted = false AND c.created_at >= p_from AND c.created_at < p_to),
      'replies', (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = ANY(v_topic_ids) AND c.parent_id IS NOT NULL AND c.is_deleted = false AND c.created_at >= p_from AND c.created_at < p_to),
      'comment_likes', (SELECT pg_catalog.count(*) FROM public.comment_likes cl JOIN public.comments c ON c.id = cl.comment_id WHERE c.topic_id = ANY(v_topic_ids) AND c.is_deleted = false AND cl.created_at >= p_from AND cl.created_at < p_to),
      'completed_topics', (SELECT pg_catalog.count(*) FROM public.progress p WHERE p.topic_id = ANY(v_topic_ids) AND p.completed_at IS NOT NULL AND p.completed_at >= p_from AND p.completed_at < p_to)
    ),
    'lifetime', pg_catalog.jsonb_build_object(
      'likes', (SELECT pg_catalog.count(*) FROM public.topic_likes l WHERE l.topic_id = ANY(v_topic_ids)),
      'bookmarks', (SELECT pg_catalog.count(*) FROM public.bookmarks b WHERE b.topic_id = ANY(v_topic_ids)),
      'comments', (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = ANY(v_topic_ids) AND c.parent_id IS NULL AND c.is_deleted = false),
      'replies', (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = ANY(v_topic_ids) AND c.parent_id IS NOT NULL AND c.is_deleted = false),
      'comment_likes', (SELECT pg_catalog.count(*) FROM public.comment_likes cl JOIN public.comments c ON c.id = cl.comment_id WHERE c.topic_id = ANY(v_topic_ids) AND c.is_deleted = false),
      'completed_topics', (SELECT pg_catalog.count(*) FROM public.progress p WHERE p.topic_id = ANY(v_topic_ids))
    )
  ) INTO v_interactions;

  IF p_entity_type = 'category' THEN
    SELECT pg_catalog.jsonb_build_object(
      'total_topics', pg_catalog.count(*),
      'published_topics', pg_catalog.count(*) FILTER (WHERE t.is_published = true),
      'unpublished_topics', pg_catalog.count(*) FILTER (WHERE t.is_published = false)
    )
    INTO v_category_content
    FROM public.topics AS t
    WHERE t.category_slug = p_entity_id;

    SELECT coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'slug', ranked.slug,
          'question', ranked.question,
          'impressions', ranked.impressions,
          'viewable_impressions', ranked.viewable_impressions,
          'likes', ranked.likes,
          'bookmarks', ranked.bookmarks,
          'comments', ranked.comments,
          'replies', ranked.replies,
          'comment_likes', ranked.comment_likes,
          'completed_topics', ranked.completed_topics
        )
        ORDER BY ranked.impressions DESC, ranked.likes DESC, ranked.bookmarks DESC,
          ranked.comment_likes DESC, ranked.comments DESC, ranked.order_index, ranked.slug
      ),
      '[]'::jsonb
    )
    INTO v_top_topics
    FROM (
      SELECT
        t.slug,
        t.question,
        t.order_index,
        coalesce(daily.impressions, 0)
          + count(e.event_id) FILTER (WHERE e.event_type = 'impression') AS impressions,
        coalesce(daily.viewable_impressions, 0)
          + count(e.event_id) FILTER (WHERE e.event_type = 'viewable_impression') AS viewable_impressions,
        (SELECT pg_catalog.count(*) FROM public.topic_likes l WHERE l.topic_id = t.id AND l.created_at >= p_from AND l.created_at < p_to) AS likes,
        (SELECT pg_catalog.count(*) FROM public.bookmarks b WHERE b.topic_id = t.id AND b.created_at >= p_from AND b.created_at < p_to) AS bookmarks,
        (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = t.id AND c.parent_id IS NULL AND c.is_deleted = false AND c.created_at >= p_from AND c.created_at < p_to) AS comments,
        (SELECT pg_catalog.count(*) FROM public.comments c WHERE c.topic_id = t.id AND c.parent_id IS NOT NULL AND c.is_deleted = false AND c.created_at >= p_from AND c.created_at < p_to) AS replies,
        (SELECT pg_catalog.count(*) FROM public.comment_likes cl JOIN public.comments c ON c.id = cl.comment_id WHERE c.topic_id = t.id AND c.is_deleted = false AND cl.created_at >= p_from AND cl.created_at < p_to) AS comment_likes,
        (SELECT pg_catalog.count(*) FROM public.progress p WHERE p.topic_id = t.id AND p.completed_at >= p_from AND p.completed_at < p_to) AS completed_topics
      FROM public.topics AS t
      LEFT JOIN (
        SELECT
          aggregate.entity_id,
          coalesce(sum(aggregate.impressions), 0) AS impressions,
          coalesce(sum(aggregate.viewable_impressions), 0) AS viewable_impressions
        FROM catho_private.feed_analytics_daily AS aggregate
        WHERE aggregate.event_date >= v_rollup_from
          AND aggregate.event_date < v_rollup_to
        GROUP BY aggregate.entity_id
      ) AS daily ON daily.entity_id = t.id
      LEFT JOIN catho_private.feed_analytics_events AS e
        ON e.entity_type = 'topic'
       AND e.entity_id = t.id
       AND e.received_at >= v_effective_from
       AND e.received_at < p_to
       AND NOT (
         e.received_at >= (v_rollup_from::timestamp AT TIME ZONE 'UTC')
         AND e.received_at < (v_rollup_to::timestamp AT TIME ZONE 'UTC')
       )
      WHERE t.category_slug = p_entity_id
        AND t.is_published = true
      GROUP BY t.id, daily.impressions, daily.viewable_impressions
      ORDER BY impressions DESC, likes DESC, bookmarks DESC, comment_likes DESC, comments DESC, t.order_index, t.slug
      LIMIT 5
    ) AS ranked;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'range_start', p_from,
    'range_end', p_to,
    'first_retained_event_at', v_first_retained_event_at,
    'last_event_at', v_last_event_at,
    'events', v_event_metrics,
    'interactions', v_interactions,
    'series', CASE
      WHEN v_first_retained_event_at IS NULL OR p_to <= v_first_retained_event_at
        THEN '[]'::jsonb
      ELSE v_series
    END,
    'category_content', v_category_content,
    'top_topics', v_top_topics
  );
END;
$function$;

ALTER FUNCTION public.get_admin_content_analytics(text, text, timestamptz, timestamptz) OWNER TO postgres;
COMMENT ON FUNCTION public.get_admin_content_analytics(text, text, timestamptz, timestamptz) IS
  'Returns privacy-safe aggregate analytics and historical interaction counts for server-authorized admin topic/category dashboards. Only service_role may execute; never returns user-level data.';

) THEN
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

    IF NOT EXISTS (
      SELECT 1 FROM public.topics t WHERE t.id = v_entity_id AND t.is_published = true
    ) THEN
      RAISE EXCEPTION 'Analytics topic is unavailable' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catho_private.feed_analytics_events (
      user_id, event_id, event_type, entity_type, entity_id,
      session_id, metadata, received_at
    )
    VALUES (
      v_user_id, v_event_id, v_event_type, v_entity_type, v_entity_id,
      v_session_id, v_metadata, statement_timestamp()
    )
    ON CONFLICT (user_id, event_id) DO NOTHING;
    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;
  RETURN v_inserted;
END;
$function$;
CREATE OR REPLACE FUNCTION catho_private.prune_feed_analytics_events(p_before timestamp with time zone DEFAULT (statement_timestamp() - '180 days'::interval), p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE
  v_deleted integer := 0;
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

  RETURN v_deleted;
END;
$function$;
CREATE OR REPLACE FUNCTION catho_private.refresh_feed_analytics_daily(p_days_back integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE
  v_from date;
  v_through date;
  v_rows integer := 0;
BEGIN
  IF p_days_back IS NULL OR p_days_back < 0 OR p_days_back > 7 THEN
    RAISE EXCEPTION 'Invalid analytics rollup window' USING ERRCODE = '22023';
  END IF;
  v_through := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_from := v_through - p_days_back;

  DELETE FROM catho_private.feed_analytics_daily
  WHERE event_date BETWEEN v_from AND v_through;

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
    statement_timestamp()
  FROM catho_private.feed_analytics_events AS event
  WHERE event.received_at >= (v_from::timestamp AT TIME ZONE 'UTC')
    AND event.received_at < ((v_through + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.entity_id
  ON CONFLICT (event_date, entity_id) DO UPDATE
  SET impressions = EXCLUDED.impressions,
      viewable_impressions = EXCLUDED.viewable_impressions,
      active_duration_ms = EXCLUDED.active_duration_ms,
      skips = EXCLUDED.skips,
      completions = EXCLUDED.completions,
      return_visits = EXCLUDED.return_visits,
      refreshed_at = EXCLUDED.refreshed_at;

  DELETE FROM catho_private.feed_analytics_daily_viewers
  WHERE event_date BETWEEN v_from AND v_through;

  INSERT INTO catho_private.feed_analytics_daily_viewers (event_date, entity_id, user_id)
  SELECT DISTINCT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.entity_id,
    event.user_id
  FROM catho_private.feed_analytics_events AS event
  WHERE event.event_type = 'viewable_impression'
    AND event.received_at >= (v_from::timestamp AT TIME ZONE 'UTC')
    AND event.received_at < ((v_through + 1)::timestamp AT TIME ZONE 'UTC')
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;
ALTER FUNCTION catho_private.refresh_feed_analytics_daily(integer) OWNER TO postgres;
-- DDL event triggers
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();

-- Scheduled retention jobs
DO $cron_restore$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cathoscroll-prune-activity' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule('cathoscroll-prune-activity', '*/5 * * * *', 'SELECT catho_private.prune_due_activity();');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cathoscroll-prune-catalogue' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule('cathoscroll-prune-catalogue', '2,17,32,47 * * * *', 'SELECT public.offline_catalogue_prune_old(clock_timestamp() - interval ''31 days'', 1000);');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cathoscroll-rollup-feed-analytics' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule('cathoscroll-rollup-feed-analytics', '*/5 * * * *',
    'SELECT catho_private.refresh_feed_analytics_daily(2);');
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cathoscroll-prune-feed-analytics' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule('cathoscroll-prune-feed-analytics', '*/15 * * * *',
    'SELECT catho_private.prune_feed_analytics_events(statement_timestamp() - interval ''180 days'', 5000);');
END;
$cron_restore$;


-- Top-comment feed selection. The RPC is callable only by the server role;
-- public clients use the rate-limited /api/content/top-comments endpoint.
CREATE INDEX IF NOT EXISTS comments_top_level_visible_created_idx
  ON public.comments (created_at DESC, id DESC)
  WHERE parent_id IS NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS comments_visible_parent_created_idx
  ON public.comments (parent_id, created_at DESC)
  WHERE is_deleted = false;

DROP FUNCTION IF EXISTS public.get_top_feed_comments();
DROP FUNCTION IF EXISTS public.get_top_feed_comments(integer, integer);
CREATE OR REPLACE FUNCTION public.get_top_feed_comments(p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 5000 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid top-comment page' USING ERRCODE = '22023';
  END IF;
  RETURN (
  WITH candidate_ids AS MATERIALIZED (
    SELECT candidate.id
    FROM public.comments AS candidate
    WHERE candidate.parent_id IS NULL
      AND candidate.is_deleted = false
      AND pg_catalog.char_length(pg_catalog.btrim(candidate.content)) > 0
      AND candidate.created_at >= pg_catalog.statement_timestamp() - interval '90 days'
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 5000
  ),
  candidates AS (
    SELECT
      comment_row.id AS comment_id,
      topic.slug AS topic_slug,
      topic.question AS topic_question,
      category.name AS category_name,
      COALESCE(
        NULLIF(pg_catalog.btrim(profile.display_name), ''),
        NULLIF(pg_catalog.btrim(profile.username), ''),
        'CathoScroll member'
      ) AS author_display_name,
      NULLIF(pg_catalog.btrim(profile.username), '') AS author_username,
      pg_catalog.left(comment_row.content, 600) AS content,
      pg_catalog.char_length(comment_row.content) > 600 AS content_truncated,
      comment_row.created_at,
      comment_row.is_pinned,
      likes.like_count,
      replies.reply_count,
      (
        (
          likes.like_count::numeric
          + (2 * replies.unique_reply_authors::numeric)
          + (0.5 * likes.recent_like_count::numeric)
          + replies.recent_reply_authors::numeric
        )
        / (
          1 + GREATEST(
            0::double precision,
            pg_catalog.date_part(
              'epoch',
              (pg_catalog.statement_timestamp() - comment_row.created_at)
            ) / 604800
          )
        )
      ) AS ranking_score
    FROM public.comments AS comment_row
    JOIN candidate_ids AS candidate_pool ON candidate_pool.id = comment_row.id
    JOIN public.topics AS topic
      ON topic.id = comment_row.topic_id
     AND topic.is_published = true
    JOIN public.categories AS category
      ON category.slug = topic.category_slug
     AND category.is_published = true
    LEFT JOIN public.profiles AS profile
      ON profile.id = comment_row.user_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.count(*)::integer AS like_count,
        pg_catalog.count(*) FILTER (
          WHERE comment_like.created_at >= pg_catalog.statement_timestamp() - interval '14 days'
        )::integer AS recent_like_count
      FROM public.comment_likes AS comment_like
      WHERE comment_like.comment_id = comment_row.id
    ) AS likes
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.count(*)::integer AS reply_count,
        pg_catalog.count(DISTINCT reply.user_id)::integer AS unique_reply_authors,
        pg_catalog.count(DISTINCT reply.user_id) FILTER (
          WHERE reply.created_at >= pg_catalog.statement_timestamp() - interval '14 days'
        )::integer AS recent_reply_authors
      FROM public.comments AS reply
      WHERE reply.parent_id = comment_row.id
        AND reply.is_deleted = false
    ) AS replies
    WHERE comment_row.parent_id IS NULL
      AND comment_row.is_deleted = false
      AND pg_catalog.char_length(pg_catalog.btrim(comment_row.content)) > 0
      AND comment_row.created_at >= pg_catalog.statement_timestamp() - interval '90 days'
      AND likes.like_count + replies.unique_reply_authors >= 3
      AND (
        likes.like_count >= 2
        OR replies.unique_reply_authors >= 1
      )
  ),
  selected AS (
    SELECT *
    FROM candidates
    ORDER BY ranking_score DESC, created_at DESC, comment_id DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT pg_catalog.jsonb_build_object(
    'comments',
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'comment_id', selected.comment_id,
            'topic_slug', selected.topic_slug,
            'topic_question', selected.topic_question,
            'category_name', selected.category_name,
            'author_display_name', selected.author_display_name,
            'author_username', selected.author_username,
            'content', selected.content,
            'content_truncated', selected.content_truncated,
            'created_at', selected.created_at,
            'is_pinned', selected.is_pinned,
            'like_count', selected.like_count,
            'reply_count', selected.reply_count
          )
          ORDER BY selected.ranking_score DESC, selected.created_at DESC, selected.comment_id DESC
        )
        FROM selected
      ),
      '[]'::jsonb
    ),
    'next_offset', CASE WHEN (SELECT pg_catalog.count(*) FROM selected) = p_limit THEN p_offset + p_limit ELSE NULL END,
    'generated_at', pg_catalog.statement_timestamp()
  )
  );
END;
$function$;

COMMENT ON FUNCTION public.get_top_feed_comments(integer, integer) IS
  'Returns a bounded page of recent, visible, top-level comments with meaningful engagement for feed interstitials. Pages are ordered by engagement score and bounded to the newest 5,000 eligible root comments in the 90-day window. Deleted comments and unpublished topics/categories are excluded.';

NOTIFY pgrst, 'reload schema';
-- Sponsor and campaign extensions to the application schema follow.

-- Private-by-default sponsor records. Payments are reconciled manually after
-- direct bank transfer; this table does not integrate with a payment provider.
CREATE TABLE public.sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name text NOT NULL CHECK (char_length(btrim(sponsor_name)) BETWEEN 2 AND 120),
  contact_email text CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  website_url text CHECK (website_url IS NULL OR website_url ~ '^https://'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed')),
  agreed_amount_minor bigint
    CHECK (agreed_amount_minor IS NULL OR agreed_amount_minor BETWEEN 0 AND 100000000000),
  currency text NOT NULL DEFAULT 'GBP' CHECK (currency IN ('GBP', 'EUR', 'USD')),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'received', 'not_required', 'refunded')),
  payment_received_at timestamptz,
  payment_reference text CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 120),
  admin_notes text NOT NULL DEFAULT '' CHECK (char_length(admin_notes) <= 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsors_valid_date_range CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT sponsors_payment_received_timestamp CHECK (
    (payment_status = 'received' AND payment_received_at IS NOT NULL)
    OR (payment_status <> 'received' AND payment_received_at IS NULL)
  )
);
DROP FUNCTION IF EXISTS public.admin_create_sponsor(
  uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text
);

CREATE INDEX sponsors_created_at_idx ON public.sponsors (created_at DESC);
CREATE INDEX sponsors_created_by_idx ON public.sponsors (created_by);
ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sponsors FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.sponsors TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_sponsor(p_actor_user_id uuid, p_sponsor_name text, p_contact_email text, p_website_url text, p_description text, p_starts_on date, p_ends_on date, p_status text, p_agreed_amount_minor bigint, p_currency text, p_payment_status text, p_payment_reference text, p_admin_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_payment_status IS NULL OR p_payment_status NOT IN ('pending', 'not_required')
     OR (p_payment_status = 'not_required' AND coalesce(p_agreed_amount_minor, 0) > 0)
     OR (p_agreed_amount_minor IS NOT NULL AND p_agreed_amount_minor < 0)
     OR p_currency IS NULL OR p_currency NOT IN ('GBP', 'EUR', 'USD') THEN
    RAISE EXCEPTION 'A sponsor with an agreed fee must use pending payment and invoice reconciliation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sponsors (
    sponsor_name, contact_email, website_url, description, starts_on, ends_on,
    status, agreed_amount_minor, currency, payment_status, payment_received_at,
    payment_reference, admin_notes, created_by
  ) VALUES (
    btrim(p_sponsor_name), nullif(btrim(p_contact_email), ''), nullif(btrim(p_website_url), ''),
    coalesce(p_description, ''), p_starts_on, p_ends_on,
    p_status, p_agreed_amount_minor, p_currency, p_payment_status, NULL,
    NULL, coalesce(p_admin_notes, ''), p_actor_user_id
  ) RETURNING * INTO v_sponsor;
  INSERT INTO catho_private.admin_action_audit (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.created', 'sponsor', v_sponsor.id::text,
    jsonb_build_object('sponsor_name', v_sponsor.sponsor_name, 'status', v_sponsor.status,
      'payment_status', v_sponsor.payment_status, 'currency', v_sponsor.currency,
      'agreed_amount_minor', v_sponsor.agreed_amount_minor));
  RETURN jsonb_build_object('id', v_sponsor.id, 'sponsor_name', v_sponsor.sponsor_name,
    'status', v_sponsor.status, 'payment_status', v_sponsor.payment_status,
    'created_at', v_sponsor.created_at);
END;
$function$;

ALTER FUNCTION public.admin_create_sponsor(
  uuid, text, text, text, text, date, date, text, bigint, text, text, text, text
) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.admin_mark_sponsor_payment_received(p_actor_user_id uuid, p_sponsor_id uuid, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sponsor
  FROM public.sponsors AS sponsors
  WHERE sponsors.id = p_sponsor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_sponsor.payment_status = 'received' THEN
    RETURN pg_catalog.jsonb_build_object(
      'id', v_sponsor.id,
      'payment_status', v_sponsor.payment_status,
      'payment_received_at', v_sponsor.payment_received_at
    );
  END IF;

  IF v_sponsor.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending bank transfers can be marked received' USING ERRCODE = '23514';
  END IF;

  UPDATE public.sponsors
  SET payment_status = 'received',
      payment_received_at = pg_catalog.statement_timestamp(),
      payment_reference = coalesce(nullif(btrim(p_payment_reference), ''), payment_reference),
      updated_at = pg_catalog.statement_timestamp()
  WHERE id = p_sponsor_id
  RETURNING * INTO v_sponsor;

  INSERT INTO catho_private.admin_action_audit (
    actor_user_id, action, target_type, target_id, details
  )
  VALUES (
    p_actor_user_id,
    'sponsor.payment_received',
    'sponsor',
    v_sponsor.id::text,
    pg_catalog.jsonb_build_object(
      'sponsor_name', v_sponsor.sponsor_name,
      'payment_status', v_sponsor.payment_status,
      'payment_reference', v_sponsor.payment_reference,
      'payment_received_at', v_sponsor.payment_received_at
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_sponsor.id,
    'payment_status', v_sponsor.payment_status,
    'payment_received_at', v_sponsor.payment_received_at
  );
END;
$function$;

ALTER FUNCTION public.admin_mark_sponsor_payment_received(uuid, uuid, text) OWNER TO postgres;
-- Sponsor campaign management, weighted delivery and aggregate reporting foundation.

CREATE TABLE public.sponsor_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE RESTRICT,
  campaign_name text NOT NULL CHECK (char_length(btrim(campaign_name)) BETWEEN 2 AND 120),
  headline text NOT NULL CHECK (char_length(btrim(headline)) BETWEEN 2 AND 100),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 500),
  image_url text CHECK (image_url IS NULL OR image_url ~ '^https://'),
  destination_url text NOT NULL CHECK (destination_url ~ '^https://'),
  cta_label text NOT NULL DEFAULT 'Learn more' CHECK (char_length(btrim(cta_label)) BETWEEN 2 AND 32),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  target_category_slugs text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_topic_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  placement_weight integer NOT NULL DEFAULT 1 CHECK (placement_weight BETWEEN 1 AND 1000),
  frequency_cap_per_user_24h integer NOT NULL DEFAULT 1 CHECK (frequency_cap_per_user_24h BETWEEN 1 AND 25),
  frequency_cap_per_user_total integer NOT NULL DEFAULT 3 CHECK (frequency_cap_per_user_total BETWEEN 1 AND 50),
  daily_impression_cap bigint CHECK (daily_impression_cap IS NULL OR daily_impression_cap BETWEEN 1 AND 1000000000),
  total_impression_cap bigint CHECK (total_impression_cap IS NULL OR total_impression_cap BETWEEN 1 AND 100000000000),
  served_count bigint NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'paused', 'completed', 'rejected')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_campaigns_valid_dates CHECK (ends_on >= starts_on),
  CONSTRAINT sponsor_campaigns_target_category_limit CHECK (cardinality(target_category_slugs) <= 100),
  CONSTRAINT sponsor_campaigns_target_topic_limit CHECK (cardinality(target_topic_ids) <= 500),
  CONSTRAINT sponsor_campaigns_approval_timestamp CHECK (
    status NOT IN ('approved', 'paused', 'completed') OR approved_at IS NOT NULL
  )
);
CREATE INDEX sponsor_campaigns_eligibility_idx ON public.sponsor_campaigns (status, starts_on, ends_on, placement_weight DESC);
CREATE INDEX sponsor_campaigns_sponsor_created_idx ON public.sponsor_campaigns (sponsor_id, created_at DESC);
CREATE INDEX sponsor_campaigns_created_by_idx ON public.sponsor_campaigns (created_by);
CREATE INDEX sponsor_campaigns_approved_by_idx ON public.sponsor_campaigns (approved_by);
ALTER TABLE public.sponsor_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sponsor_campaigns FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sponsor_campaigns TO service_role;

CREATE TABLE catho_private.sponsor_campaign_events (
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('served', 'viewable_impression', 'click')),
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (campaign_id, event_id)
);
CREATE INDEX sponsor_campaign_events_user_campaign_time_idx ON catho_private.sponsor_campaign_events (user_id, campaign_id, received_at DESC);
CREATE INDEX sponsor_campaign_events_received_at_idx ON catho_private.sponsor_campaign_events (received_at);
CREATE UNIQUE INDEX sponsor_campaign_events_one_viewable_per_session_idx
  ON catho_private.sponsor_campaign_events (campaign_id, user_id, session_id)
  WHERE event_type = 'viewable_impression';
CREATE UNIQUE INDEX sponsor_campaign_events_one_click_per_session_idx
  ON catho_private.sponsor_campaign_events (campaign_id, user_id, session_id)
  WHERE event_type = 'click';

CREATE TABLE catho_private.sponsor_campaign_daily (
  event_date date NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  served_count bigint NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  viewable_impressions bigint NOT NULL DEFAULT 0 CHECK (viewable_impressions >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (event_date, campaign_id)
);
CREATE INDEX sponsor_campaign_daily_campaign_date_idx ON catho_private.sponsor_campaign_daily (campaign_id, event_date DESC);

CREATE TABLE catho_private.sponsor_campaign_user_frequency (
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  served_count integer NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  last_served_at timestamptz NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX sponsor_campaign_user_frequency_user_idx ON catho_private.sponsor_campaign_user_frequency (user_id, campaign_id);

ALTER TABLE catho_private.sponsor_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.sponsor_campaign_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.sponsor_campaign_user_frequency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_daily FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_user_frequency FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_sponsor_campaign(p_actor_user_id uuid, p_sponsor_id uuid, p_campaign_name text, p_headline text, p_body text, p_image_url text, p_destination_url text, p_cta_label text, p_starts_on date, p_ends_on date, p_target_category_slugs text[], p_target_topic_ids text[], p_placement_weight integer, p_frequency_cap_per_user_24h integer, p_frequency_cap_per_user_total integer, p_daily_impression_cap bigint, p_total_impression_cap bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_campaign public.sponsor_campaigns%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sponsors AS sponsor WHERE sponsor.id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on
     OR p_destination_url IS NULL OR p_destination_url !~ '^https://'
     OR (p_image_url IS NOT NULL AND p_image_url !~ '^https://')
     OR p_target_category_slugs IS NULL OR cardinality(p_target_category_slugs) > 100
     OR p_target_topic_ids IS NULL OR cardinality(p_target_topic_ids) > 500
     OR p_placement_weight NOT BETWEEN 1 AND 1000
     OR p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 25
     OR p_frequency_cap_per_user_total NOT BETWEEN 1 AND 50
     OR (p_daily_impression_cap IS NOT NULL AND p_daily_impression_cap NOT BETWEEN 1 AND 1000000000)
     OR (p_total_impression_cap IS NOT NULL AND p_total_impression_cap NOT BETWEEN 1 AND 100000000000) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign configuration' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_target_category_slugs) AS target(slug)
    WHERE NOT EXISTS (SELECT 1 FROM public.categories AS category WHERE category.slug = target.slug)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_target_topic_ids) AS target(topic_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.topics AS topic WHERE topic.id = target.topic_id)
  ) THEN
    RAISE EXCEPTION 'Unknown campaign targeting value' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sponsor_campaigns (
    sponsor_id, campaign_name, headline, body, image_url, destination_url, cta_label,
    starts_on, ends_on, target_category_slugs, target_topic_ids, placement_weight,
    frequency_cap_per_user_24h, frequency_cap_per_user_total,
    daily_impression_cap, total_impression_cap, created_by
  )
  VALUES (
    p_sponsor_id, btrim(p_campaign_name), btrim(p_headline), btrim(p_body),
    nullif(btrim(p_image_url), ''), btrim(p_destination_url),
    coalesce(nullif(btrim(p_cta_label), ''), 'Learn more'),
    p_starts_on, p_ends_on, p_target_category_slugs, p_target_topic_ids,
    p_placement_weight, p_frequency_cap_per_user_24h, p_frequency_cap_per_user_total,
    p_daily_impression_cap, p_total_impression_cap, p_actor_user_id
  )
  RETURNING * INTO v_campaign;

  INSERT INTO catho_private.admin_action_audit (
    actor_user_id, action, target_type, target_id, details
  )
  VALUES (
    p_actor_user_id, 'sponsor_campaign.created', 'sponsor_campaign', v_campaign.id::text,
    pg_catalog.jsonb_build_object(
      'sponsor_id', v_campaign.sponsor_id,
      'campaign_name', v_campaign.campaign_name,
      'placement_weight', v_campaign.placement_weight,
      'status', v_campaign.status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_campaign.id,
    'campaign_name', v_campaign.campaign_name,
    'status', v_campaign.status,
    'created_at', v_campaign.created_at
  );
END;
$function$;
ALTER FUNCTION public.admin_create_sponsor_campaign(
  uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint
) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.admin_set_sponsor_campaign_status(p_actor_user_id uuid, p_campaign_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_campaign public.sponsor_campaigns%ROWTYPE;
  v_sponsor public.sponsors%ROWTYPE;
  v_new_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.sponsor_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_sponsor FROM public.sponsors AS sponsor WHERE sponsor.id = v_campaign.sponsor_id;

  CASE p_action
    WHEN 'approve' THEN
      IF v_campaign.status NOT IN ('draft', 'pending_approval', 'paused')
         OR v_sponsor.status NOT IN ('active', 'scheduled')
         OR v_sponsor.payment_status NOT IN ('received', 'not_required') THEN
        RAISE EXCEPTION 'Campaign requires an active sponsor and reconciled payment before approval' USING ERRCODE = '23514';
      END IF;
      v_new_status := 'approved';
      UPDATE public.sponsor_campaigns
      SET status = v_new_status, approved_by = p_actor_user_id,
          approved_at = pg_catalog.statement_timestamp(), updated_at = pg_catalog.statement_timestamp()
      WHERE id = p_campaign_id
      RETURNING * INTO v_campaign;
    WHEN 'pause' THEN
      IF v_campaign.status <> 'approved' THEN
        RAISE EXCEPTION 'Only approved campaigns can be paused' USING ERRCODE = '23514';
      END IF;
      v_new_status := 'paused';
      UPDATE public.sponsor_campaigns
      SET status = v_new_status, updated_at = pg_catalog.statement_timestamp()
      WHERE id = p_campaign_id
      RETURNING * INTO v_campaign;
    WHEN 'resume' THEN
      IF v_campaign.status <> 'paused'
         OR v_sponsor.status NOT IN ('active', 'scheduled')
         OR v_sponsor.payment_status NOT IN ('received', 'not_required') THEN
        RAISE EXCEPTION 'Campaign cannot be resumed until its sponsor and payment are eligible' USING ERRCODE = '23514';
      END IF;
      v_new_status := 'approved';
      UPDATE public.sponsor_campaigns
      SET status = v_new_status, updated_at = pg_catalog.statement_timestamp()
      WHERE id = p_campaign_id
      RETURNING * INTO v_campaign;
    WHEN 'complete' THEN
      IF v_campaign.status NOT IN ('approved', 'paused') THEN
        RAISE EXCEPTION 'Only approved or paused campaigns can be completed' USING ERRCODE = '23514';
      END IF;
      v_new_status := 'completed';
      UPDATE public.sponsor_campaigns
      SET status = v_new_status, updated_at = pg_catalog.statement_timestamp()
      WHERE id = p_campaign_id
      RETURNING * INTO v_campaign;
    WHEN 'reject' THEN
      IF v_campaign.status NOT IN ('draft', 'pending_approval', 'approved', 'paused') THEN
        RAISE EXCEPTION 'Campaign cannot be rejected in its current state' USING ERRCODE = '23514';
      END IF;
      v_new_status := 'rejected';
      UPDATE public.sponsor_campaigns
      SET status = v_new_status, updated_at = pg_catalog.statement_timestamp()
      WHERE id = p_campaign_id
      RETURNING * INTO v_campaign;
    ELSE
      RAISE EXCEPTION 'Invalid campaign action' USING ERRCODE = '22023';
  END CASE;

  INSERT INTO catho_private.admin_action_audit (
    actor_user_id, action, target_type, target_id, details
  )
  VALUES (
    p_actor_user_id, 'sponsor_campaign.' || p_action, 'sponsor_campaign',
    v_campaign.id::text,
    pg_catalog.jsonb_build_object(
      'campaign_name', v_campaign.campaign_name,
      'sponsor_id', v_campaign.sponsor_id,
      'status', v_campaign.status
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_campaign.id,
    'campaign_name', v_campaign.campaign_name,
    'status', v_campaign.status,
    'approved_at', v_campaign.approved_at
  );
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_campaign_status(uuid, uuid, text) OWNER TO postgres;
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
CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(p_user_id uuid, p_campaign_id uuid, p_event_id uuid, p_session_id uuid, p_event_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date;
  v_inserted integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_event_type IS NULL OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.user_analytics_consents AS consent
    WHERE consent.user_id = p_user_id AND consent.sponsor_measurement = true
  ) THEN RETURN false; END IF;
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
CREATE OR REPLACE FUNCTION catho_private.prune_sponsor_campaign_events(p_before timestamp with time zone DEFAULT (statement_timestamp() - '180 days'::interval), p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE v_deleted integer := 0;
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
        campaign.ends_on < (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date
        OR sponsor.status = 'completed'
        OR (sponsor.ends_on IS NOT NULL
          AND sponsor.ends_on < (pg_catalog.timezone('UTC', pg_catalog.statement_timestamp()))::date)
      )
    ORDER BY campaign.ends_on, campaign.id
    LIMIT p_limit
  )
  UPDATE public.sponsor_campaigns AS campaign
  SET status = 'completed', updated_at = pg_catalog.statement_timestamp()
  FROM expired_campaigns
  WHERE campaign.id = expired_campaigns.id;

  WITH expired AS (
    SELECT event.ctid FROM catho_private.sponsor_campaign_events AS event
    WHERE event.received_at < p_before ORDER BY event.received_at LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_events AS event USING expired
  WHERE event.ctid=expired.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired_frequency AS (
    SELECT frequency.ctid
    FROM catho_private.sponsor_campaign_user_frequency AS frequency
    JOIN public.sponsor_campaigns AS campaign ON campaign.id=frequency.campaign_id
    WHERE campaign.status IN ('completed','rejected')
      AND (campaign.updated_at < p_before
        OR campaign.ends_on < (p_before AT TIME ZONE 'UTC')::date)
    ORDER BY campaign.updated_at LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_user_frequency AS frequency USING expired_frequency
  WHERE frequency.ctid=expired_frequency.ctid;
  RETURN v_deleted;
END;
$function$;
DO $sponsor_cron$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='cathoscroll-prune-sponsor-campaign-events' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule('cathoscroll-prune-sponsor-campaign-events','*/15 * * * *',
    'SELECT catho_private.prune_sponsor_campaign_events(statement_timestamp() - interval ''180 days'', 5000);');
END;
$sponsor_cron$;



CREATE OR REPLACE FUNCTION public.get_admin_sponsor_campaign_analytics(p_actor_user_id uuid, p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29), p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=p_actor_user_id) THEN
  RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>179 THEN
  RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE='22023'; END IF;
 WITH auth AS (
  SELECT d.campaign_id,sum(d.served_count) served,sum(d.viewable_impressions) viewable_impressions,sum(d.clicks) clicks
  FROM catho_private.sponsor_campaign_daily d WHERE d.event_date BETWEEN p_from AND p_to GROUP BY d.campaign_id
 ), anon AS (
  SELECT d.campaign_id,sum(d.served_count) served,sum(d.viewable_impressions) viewable_impressions,sum(d.clicks) clicks
  FROM catho_private.anonymous_sponsor_campaign_daily d WHERE d.event_date BETWEEN p_from AND p_to GROUP BY d.campaign_id
 ), metrics AS (
  SELECT c.id campaign_id,coalesce(a.served,0) served,coalesce(a.viewable_impressions,0) viewable_impressions,
   coalesce(a.clicks,0) clicks,coalesce(n.served,0) anonymous_served,
   coalesce(n.viewable_impressions,0) anonymous_viewable_impressions,coalesce(n.clicks,0) anonymous_clicks
  FROM public.sponsor_campaigns c LEFT JOIN auth a ON a.campaign_id=c.id LEFT JOIN anon n ON n.campaign_id=c.id
 )
 SELECT jsonb_build_object('from',p_from,'to',p_to,'campaigns',coalesce(jsonb_agg(jsonb_build_object(
  'campaign_id',m.campaign_id,'served',m.served,'viewable_impressions',m.viewable_impressions,'clicks',m.clicks,
  'anonymous_served',m.anonymous_served,'anonymous_viewable_impressions',m.anonymous_viewable_impressions,'anonymous_clicks',m.anonymous_clicks,
  'total_served',m.served+m.anonymous_served,'total_viewable_impressions',m.viewable_impressions+m.anonymous_viewable_impressions,
  'total_clicks',m.clicks+m.anonymous_clicks,
  'click_through_rate',CASE WHEN m.viewable_impressions+m.anonymous_viewable_impressions>0
   THEN round((m.clicks+m.anonymous_clicks)::numeric*100/(m.viewable_impressions+m.anonymous_viewable_impressions),2) ELSE 0 END
 ) ORDER BY m.served+m.anonymous_served DESC,m.campaign_id),'[]'::jsonb)) INTO v_result FROM metrics m;
 RETURN v_result;
END; $function$;
ALTER FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) OWNER TO postgres;
-- Applied migration: sponsor_accounts_and_self_service_campaigns

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

CREATE OR REPLACE FUNCTION public.admin_add_sponsor_member(p_actor_user_id uuid, p_sponsor_id uuid, p_user_id uuid, p_role text DEFAULT 'owner'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
CREATE OR REPLACE FUNCTION public.admin_set_sponsor_member_status(p_actor_user_id uuid, p_membership_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  IF v_membership.role = 'owner' AND p_action IN ('suspend', 'revoke')
     AND NOT EXISTS (
       SELECT 1 FROM public.sponsor_memberships AS other
       WHERE other.sponsor_id = v_membership.sponsor_id
         AND other.id <> v_membership.id AND other.role = 'owner' AND other.status = 'active'
     ) THEN
    RAISE EXCEPTION 'The last active sponsor owner cannot be suspended or revoked' USING ERRCODE = '23514';
  END IF;
  v_status := CASE p_action WHEN 'suspend' THEN 'suspended'
    WHEN 'reactivate' THEN 'active' ELSE 'revoked' END;
  UPDATE public.sponsor_memberships SET status = v_status, updated_at = statement_timestamp()
  WHERE id = p_membership_id RETURNING * INTO v_membership;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.member_' || p_action, 'sponsor_membership', v_membership.id::text,
    jsonb_build_object('sponsor_id', v_membership.sponsor_id,
      'user_id', v_membership.user_id, 'role', v_membership.role));
  RETURN jsonb_build_object('id', v_membership.id, 'sponsor_id', v_membership.sponsor_id,
    'user_id', v_membership.user_id, 'role', v_membership.role, 'status', v_membership.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.sponsor_create_campaign(p_actor_user_id uuid, p_sponsor_id uuid, p_campaign_name text, p_headline text, p_body text, p_image_url text, p_destination_url text, p_cta_label text, p_starts_on date, p_ends_on date, p_target_category_slugs text[], p_target_topic_ids text[], p_placement_weight integer, p_frequency_cap_per_user_24h integer, p_frequency_cap_per_user_total integer, p_daily_impression_cap bigint, p_total_impression_cap bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
     OR p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 25
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
CREATE OR REPLACE FUNCTION public.sponsor_update_campaign(p_actor_user_id uuid, p_campaign_id uuid, p_campaign_name text, p_headline text, p_body text, p_image_url text, p_destination_url text, p_cta_label text, p_starts_on date, p_ends_on date, p_target_category_slugs text[], p_target_topic_ids text[], p_placement_weight integer, p_frequency_cap_per_user_24h integer, p_frequency_cap_per_user_total integer, p_daily_impression_cap bigint, p_total_impression_cap bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
     OR p_frequency_cap_per_user_24h NOT BETWEEN 1 AND 25
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
CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(p_actor_user_id uuid, p_sponsor_id uuid, p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29), p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.sponsor_memberships m
  WHERE m.sponsor_id=p_sponsor_id AND m.user_id=p_actor_user_id AND m.status='active') THEN
  RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>179 THEN
  RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE='22023'; END IF;
 WITH campaigns AS (
  SELECT c.id,c.campaign_name,c.status FROM public.sponsor_campaigns c WHERE c.sponsor_id=p_sponsor_id
 ), auth AS (
  SELECT d.campaign_id,sum(d.served_count) served,sum(d.viewable_impressions) viewable_impressions,sum(d.clicks) clicks
  FROM catho_private.sponsor_campaign_daily d JOIN campaigns c ON c.id=d.campaign_id
  WHERE d.event_date BETWEEN p_from AND p_to GROUP BY d.campaign_id
 ), anon AS (
  SELECT d.campaign_id,sum(d.served_count) served,sum(d.viewable_impressions) viewable_impressions,sum(d.clicks) clicks
  FROM catho_private.anonymous_sponsor_campaign_daily d JOIN campaigns c ON c.id=d.campaign_id
  WHERE d.event_date BETWEEN p_from AND p_to GROUP BY d.campaign_id
 ), metrics AS (
  SELECT c.id campaign_id,c.campaign_name,c.status,coalesce(a.served,0) served,
   coalesce(a.viewable_impressions,0) viewable_impressions,coalesce(a.clicks,0) clicks,
   coalesce(n.served,0) anonymous_served,coalesce(n.viewable_impressions,0) anonymous_viewable_impressions,
   coalesce(n.clicks,0) anonymous_clicks
  FROM campaigns c LEFT JOIN auth a ON a.campaign_id=c.id LEFT JOIN anon n ON n.campaign_id=c.id
 )
 SELECT jsonb_build_object('from',p_from,'to',p_to,'campaigns',coalesce(jsonb_agg(jsonb_build_object(
  'campaign_id',m.campaign_id,'campaign_name',m.campaign_name,'status',m.status,
  'served',m.served,'viewable_impressions',m.viewable_impressions,'clicks',m.clicks,
  'anonymous_served',m.anonymous_served,'anonymous_viewable_impressions',m.anonymous_viewable_impressions,'anonymous_clicks',m.anonymous_clicks,
  'total_served',m.served+m.anonymous_served,'total_viewable_impressions',m.viewable_impressions+m.anonymous_viewable_impressions,
  'total_clicks',m.clicks+m.anonymous_clicks,
  'click_through_rate',CASE WHEN m.viewable_impressions+m.anonymous_viewable_impressions>0
   THEN round((m.clicks+m.anonymous_clicks)::numeric*100/(m.viewable_impressions+m.anonymous_viewable_impressions),2) ELSE 0 END
 ) ORDER BY m.served+m.anonymous_served DESC,m.campaign_name),'[]'::jsonb)) INTO v_result FROM metrics m;
 RETURN v_result;
END; $function$;
ALTER FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) OWNER TO postgres;
-- Applied migration: harden_sponsor_membership_rpc_null_validation



-- Applied migration: sponsor_invoice_and_payment_reconciliation_ledger

CREATE TABLE catho_private.sponsor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 500),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  currency text NOT NULL CHECK (currency IN ('GBP', 'EUR', 'USD')),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_invoices_valid_dates CHECK (due_on >= issued_on)
);
CREATE INDEX sponsor_invoices_sponsor_created_idx
  ON catho_private.sponsor_invoices (sponsor_id, created_at DESC);
CREATE INDEX sponsor_invoices_status_due_idx
  ON catho_private.sponsor_invoices (status, due_on);

CREATE TABLE catho_private.sponsor_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES catho_private.sponsor_invoices(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('payment', 'refund')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  currency text NOT NULL CHECK (currency IN ('GBP', 'EUR', 'USD')),
  bank_reference text CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 120),
  bank_transaction_date date,
  bank_transaction_key text CHECK (bank_transaction_key IS NULL OR char_length(bank_transaction_key) BETWEEN 1 AND 160),
  refund_of_payment_id uuid REFERENCES catho_private.sponsor_payment_transactions(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_payment_transaction_shape CHECK (
    (transaction_type = 'payment' AND refund_of_payment_id IS NULL)
    OR (transaction_type = 'refund' AND refund_of_payment_id IS NOT NULL)
  )
);
CREATE INDEX sponsor_payment_transactions_sponsor_created_idx
  ON catho_private.sponsor_payment_transactions (sponsor_id, received_at DESC);
CREATE INDEX sponsor_payment_transactions_invoice_created_idx
  ON catho_private.sponsor_payment_transactions (invoice_id, received_at DESC);
CREATE INDEX sponsor_payment_transactions_refund_idx
  ON catho_private.sponsor_payment_transactions (refund_of_payment_id)
  WHERE refund_of_payment_id IS NOT NULL;
CREATE UNIQUE INDEX sponsor_payment_transactions_bank_key_idx
  ON catho_private.sponsor_payment_transactions (bank_transaction_key)
  WHERE bank_transaction_key IS NOT NULL;

ALTER TABLE catho_private.sponsor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.sponsor_payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_invoices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.sponsor_payment_transactions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_sponsor_invoice(p_actor_user_id uuid, p_sponsor_id uuid, p_description text, p_amount_minor bigint, p_currency text, p_issued_on date, p_due_on date, p_issue_now boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = p_sponsor_id;
  IF NOT FOUND OR char_length(btrim(coalesce(p_description, ''))) NOT BETWEEN 2 AND 500
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000000
     OR p_currency IS NULL OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR p_currency <> v_sponsor.currency
     OR p_issued_on IS NULL OR p_due_on IS NULL OR p_due_on < p_issued_on
     OR p_issue_now IS NULL THEN
    RAISE EXCEPTION 'Invoice details must match the sponsor agreement and use valid dates and amounts' USING ERRCODE = '22023';
  END IF;
  INSERT INTO catho_private.sponsor_invoices
    (sponsor_id, description, amount_minor, currency, issued_on, due_on, status, created_by)
  VALUES (p_sponsor_id, btrim(p_description), p_amount_minor, p_currency, p_issued_on, p_due_on,
    CASE WHEN p_issue_now THEN 'issued' ELSE 'draft' END, p_actor_user_id)
  RETURNING * INTO v_invoice;
  IF p_issue_now THEN
    UPDATE public.sponsors
    SET payment_status = 'pending', payment_received_at = NULL, updated_at = statement_timestamp()
    WHERE id = p_sponsor_id;
  END IF;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.invoice_created', 'sponsor_invoice', v_invoice.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'invoice_number', v_invoice.invoice_number,
      'amount_minor', p_amount_minor, 'currency', p_currency, 'status', v_invoice.status));
  RETURN jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'sponsor_id', v_invoice.sponsor_id, 'amount_minor', v_invoice.amount_minor,
    'currency', v_invoice.currency, 'status', v_invoice.status);
END;
$function$;
ALTER FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.admin_set_sponsor_invoice_status(p_actor_user_id uuid, p_invoice_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_invoice catho_private.sponsor_invoices%ROWTYPE; v_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_invoice_id IS NULL OR p_action IS NULL OR p_action NOT IN ('issue', 'void') THEN
    RAISE EXCEPTION 'Invalid invoice action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'issue' THEN
    IF v_invoice.status <> 'draft' THEN RAISE EXCEPTION 'Only draft invoices can be issued' USING ERRCODE = '23514'; END IF;
    v_status := 'issued';
  ELSE
    IF v_invoice.status NOT IN ('draft', 'issued') OR EXISTS (
      SELECT 1 FROM catho_private.sponsor_payment_transactions AS transaction
      WHERE transaction.invoice_id = p_invoice_id AND transaction.transaction_type = 'payment'
        AND NOT EXISTS (
          SELECT 1 FROM catho_private.sponsor_payment_transactions AS refund
          WHERE refund.refund_of_payment_id = transaction.id
          GROUP BY refund.refund_of_payment_id
          HAVING sum(refund.amount_minor) >= transaction.amount_minor
        )
    ) THEN RAISE EXCEPTION 'An invoice with unreversed payments cannot be voided' USING ERRCODE = '23514'; END IF;
    v_status := 'void';
  END IF;
  UPDATE catho_private.sponsor_invoices
  SET status = v_status, updated_at = statement_timestamp()
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.invoice_' || p_action, 'sponsor_invoice', v_invoice.id::text,
    jsonb_build_object('sponsor_id', v_invoice.sponsor_id, 'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status));
  RETURN jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'status', v_invoice.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.admin_record_sponsor_payment(p_actor_user_id uuid, p_sponsor_id uuid, p_invoice_id uuid, p_amount_minor bigint, p_currency text, p_bank_reference text DEFAULT NULL::text, p_bank_transaction_date date DEFAULT NULL::date, p_bank_transaction_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_payment catho_private.sponsor_payment_transactions%ROWTYPE;
  v_inserted integer := 0;
  v_paid_minor bigint := 0;
  v_balance_minor bigint := 0;
  v_net_sponsor_paid bigint := 0;
  v_refund_total bigint := 0;
  v_outstanding_invoice_minor bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
  v_fully_reconciled boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_invoice_id IS NULL OR p_amount_minor IS NULL
     OR p_amount_minor NOT BETWEEN 1 AND 100000000000 OR p_currency IS NULL
     OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR (p_bank_reference IS NOT NULL AND char_length(p_bank_reference) > 120)
     OR (p_bank_transaction_key IS NOT NULL AND char_length(p_bank_transaction_key) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Invalid bank payment details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices
  WHERE id = p_invoice_id AND sponsor_id = p_sponsor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found for this sponsor' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status NOT IN ('issued', 'paid') OR v_invoice.currency <> p_currency THEN
    RAISE EXCEPTION 'Payment must match an issued invoice and its currency' USING ERRCODE = '23514';
  END IF;
  IF p_bank_transaction_key IS NOT NULL THEN
    SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
    WHERE bank_transaction_key = p_bank_transaction_key;
    IF FOUND THEN
      IF v_payment.sponsor_id = p_sponsor_id AND v_payment.invoice_id = p_invoice_id
         AND v_payment.transaction_type = 'payment' AND v_payment.amount_minor = p_amount_minor
         AND v_payment.currency = p_currency THEN
        RETURN jsonb_build_object('id', v_payment.id, 'duplicate', true,
          'invoice_id', v_payment.invoice_id, 'amount_minor', v_payment.amount_minor);
      END IF;
      RAISE EXCEPTION 'Bank transaction reference has already been used' USING ERRCODE = '23505';
    END IF;
  END IF;
  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_paid_minor
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = p_invoice_id;
  v_balance_minor := v_invoice.amount_minor - v_paid_minor;
  IF v_balance_minor <= 0 OR p_amount_minor > v_balance_minor THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding invoice balance' USING ERRCODE = '23514';
  END IF;
  INSERT INTO catho_private.sponsor_payment_transactions
    (sponsor_id, invoice_id, transaction_type, amount_minor, currency, bank_reference,
     bank_transaction_date, bank_transaction_key, recorded_by)
  VALUES (p_sponsor_id, p_invoice_id, 'payment', p_amount_minor, p_currency,
    nullif(btrim(p_bank_reference), ''), p_bank_transaction_date,
    nullif(btrim(p_bank_transaction_key), ''), p_actor_user_id)
  ON CONFLICT DO NOTHING RETURNING * INTO v_payment;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    IF p_bank_transaction_key IS NOT NULL THEN
      SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
      WHERE bank_transaction_key = p_bank_transaction_key;
      IF FOUND AND v_payment.sponsor_id = p_sponsor_id AND v_payment.invoice_id = p_invoice_id
         AND v_payment.transaction_type = 'payment' AND v_payment.amount_minor = p_amount_minor
         AND v_payment.currency = p_currency THEN
        RETURN jsonb_build_object('id', v_payment.id, 'duplicate', true,
          'invoice_id', v_payment.invoice_id, 'amount_minor', v_payment.amount_minor);
      END IF;
    END IF;
    RAISE EXCEPTION 'Unable to record duplicate bank transaction' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_paid_minor
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = p_invoice_id;
  IF v_paid_minor >= v_invoice.amount_minor THEN
    UPDATE catho_private.sponsor_invoices SET status = 'paid', updated_at = statement_timestamp()
    WHERE id = p_invoice_id;
  END IF;

  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = p_sponsor_id FOR UPDATE;
  SELECT
    coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
      THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0),
    coalesce(sum(transaction.amount_minor) FILTER (WHERE transaction.transaction_type = 'refund'), 0)
  INTO v_net_sponsor_paid, v_refund_total
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.sponsor_id = p_sponsor_id;
  SELECT coalesce(sum(greatest(invoice.amount_minor - coalesce(paid.paid_minor, 0), 0)), 0)
  INTO v_outstanding_invoice_minor
  FROM catho_private.sponsor_invoices AS invoice
  LEFT JOIN (
    SELECT invoice_id,
      sum(CASE WHEN transaction_type = 'payment' THEN amount_minor ELSE -amount_minor END) AS paid_minor
    FROM catho_private.sponsor_payment_transactions
    GROUP BY invoice_id
  ) AS paid ON paid.invoice_id = invoice.id
  WHERE invoice.sponsor_id = p_sponsor_id AND invoice.status = 'issued';
  v_fully_reconciled := v_outstanding_invoice_minor = 0
    AND (v_sponsor.agreed_amount_minor IS NULL OR v_net_sponsor_paid >= v_sponsor.agreed_amount_minor);
  UPDATE public.sponsors SET
    payment_status = CASE
      WHEN v_fully_reconciled THEN 'received'
      WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
      ELSE 'pending'
    END,
    payment_received_at = CASE
      WHEN v_fully_reconciled THEN coalesce(payment_received_at, statement_timestamp())
      ELSE NULL
    END,
    payment_reference = coalesce(nullif(btrim(p_bank_reference), ''), payment_reference),
    updated_at = statement_timestamp()
  WHERE id = p_sponsor_id;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_recorded', 'sponsor_payment', v_payment.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'invoice_id', p_invoice_id,
      'amount_minor', p_amount_minor, 'currency', p_currency, 'bank_reference', p_bank_reference));
  RETURN jsonb_build_object('id', v_payment.id, 'duplicate', false,
    'invoice_id', p_invoice_id, 'amount_minor', p_amount_minor,
    'invoice_paid_minor', v_paid_minor, 'invoice_balance_minor', greatest(v_invoice.amount_minor - v_paid_minor, 0),
    'sponsor_payment_status', CASE WHEN v_fully_reconciled THEN 'received' ELSE 'pending' END);
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.admin_record_sponsor_refund(p_actor_user_id uuid, p_payment_id uuid, p_amount_minor bigint, p_bank_reference text DEFAULT NULL::text, p_bank_transaction_date date DEFAULT NULL::date, p_bank_transaction_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_payment catho_private.sponsor_payment_transactions%ROWTYPE;
  v_refund catho_private.sponsor_payment_transactions%ROWTYPE;
  v_refunded_minor bigint := 0;
  v_net_sponsor_paid bigint := 0;
  v_refund_total bigint := 0;
  v_outstanding_invoice_minor bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_invoice_paid bigint := 0;
  v_fully_reconciled boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_payment_id IS NULL OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000000
     OR (p_bank_reference IS NOT NULL AND char_length(p_bank_reference) > 120)
     OR (p_bank_transaction_key IS NOT NULL AND char_length(p_bank_transaction_key) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Invalid refund details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
  WHERE id = p_payment_id AND transaction_type = 'payment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original payment not found' USING ERRCODE = 'P0002'; END IF;
  IF p_bank_transaction_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM catho_private.sponsor_payment_transactions
    WHERE bank_transaction_key = p_bank_transaction_key
  ) THEN RAISE EXCEPTION 'Bank transaction reference has already been used' USING ERRCODE = '23505'; END IF;
  SELECT coalesce(sum(refund.amount_minor), 0) INTO v_refunded_minor
  FROM catho_private.sponsor_payment_transactions AS refund
  WHERE refund.refund_of_payment_id = p_payment_id;
  IF p_amount_minor > v_payment.amount_minor - v_refunded_minor THEN
    RAISE EXCEPTION 'Refund exceeds the unrefunded payment amount' USING ERRCODE = '23514';
  END IF;
  INSERT INTO catho_private.sponsor_payment_transactions
    (sponsor_id, invoice_id, transaction_type, amount_minor, currency, bank_reference,
     bank_transaction_date, bank_transaction_key, refund_of_payment_id, recorded_by)
  VALUES (v_payment.sponsor_id, v_payment.invoice_id, 'refund', p_amount_minor, v_payment.currency,
    nullif(btrim(p_bank_reference), ''), p_bank_transaction_date,
    nullif(btrim(p_bank_transaction_key), ''), p_payment_id, p_actor_user_id)
  RETURNING * INTO v_refund;

  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices
  WHERE id = v_payment.invoice_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_invoice_paid FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = v_payment.invoice_id;
  IF v_invoice_paid < v_invoice.amount_minor AND v_invoice.status = 'paid' THEN
    UPDATE catho_private.sponsor_invoices SET status = 'issued', updated_at = statement_timestamp()
    WHERE id = v_invoice.id;
  END IF;

  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = v_payment.sponsor_id FOR UPDATE;
  SELECT
    coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
      THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0),
    coalesce(sum(transaction.amount_minor) FILTER (WHERE transaction.transaction_type = 'refund'), 0)
  INTO v_net_sponsor_paid, v_refund_total
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.sponsor_id = v_payment.sponsor_id;
  SELECT coalesce(sum(greatest(invoice.amount_minor - coalesce(paid.paid_minor, 0), 0)), 0)
  INTO v_outstanding_invoice_minor
  FROM catho_private.sponsor_invoices AS invoice
  LEFT JOIN (
    SELECT invoice_id,
      sum(CASE WHEN transaction_type = 'payment' THEN amount_minor ELSE -amount_minor END) AS paid_minor
    FROM catho_private.sponsor_payment_transactions
    GROUP BY invoice_id
  ) AS paid ON paid.invoice_id = invoice.id
  WHERE invoice.sponsor_id = v_payment.sponsor_id AND invoice.status = 'issued';
  v_fully_reconciled := v_outstanding_invoice_minor = 0
    AND (v_sponsor.agreed_amount_minor IS NULL OR v_net_sponsor_paid >= v_sponsor.agreed_amount_minor);
  UPDATE public.sponsors SET
    payment_status = CASE
      WHEN v_fully_reconciled THEN 'received'
      WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
      ELSE 'pending'
    END,
    payment_received_at = CASE
      WHEN v_fully_reconciled THEN coalesce(payment_received_at, statement_timestamp())
      ELSE NULL
    END,
    updated_at = statement_timestamp()
  WHERE id = v_payment.sponsor_id;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_refunded', 'sponsor_payment', v_refund.id::text,
    jsonb_build_object('sponsor_id', v_payment.sponsor_id, 'invoice_id', v_payment.invoice_id,
      'original_payment_id', p_payment_id, 'amount_minor', p_amount_minor, 'currency', v_payment.currency));
  RETURN jsonb_build_object('id', v_refund.id, 'original_payment_id', p_payment_id,
    'amount_minor', p_amount_minor, 'invoice_paid_minor', v_invoice_paid,
    'sponsor_payment_status', CASE WHEN v_fully_reconciled THEN 'received' ELSE 'pending' END);
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_admin_sponsor_financials(p_actor_user_id uuid, p_sponsor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', invoice.id, 'invoice_number', invoice.invoice_number, 'description', invoice.description,
        'amount_minor', invoice.amount_minor, 'currency', invoice.currency,
        'issued_on', invoice.issued_on, 'due_on', invoice.due_on, 'status', invoice.status,
        'paid_minor', invoice.paid_minor, 'balance_minor', greatest(invoice.amount_minor - invoice.paid_minor, 0)
      ) ORDER BY invoice.created_at DESC)
      FROM (
        SELECT inv.*, coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
          THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0) AS paid_minor
        FROM catho_private.sponsor_invoices AS inv
        LEFT JOIN catho_private.sponsor_payment_transactions AS transaction ON transaction.invoice_id = inv.id
        WHERE inv.sponsor_id = p_sponsor_id
        GROUP BY inv.id ORDER BY inv.created_at DESC LIMIT 100
      ) AS invoice
    ), '[]'::jsonb),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', transaction.id, 'invoice_id', transaction.invoice_id,
        'transaction_type', transaction.transaction_type, 'amount_minor', transaction.amount_minor,
        'currency', transaction.currency, 'bank_reference', transaction.bank_reference,
        'bank_transaction_date', transaction.bank_transaction_date,
        'received_at', transaction.received_at, 'refund_of_payment_id', transaction.refund_of_payment_id
      ) ORDER BY transaction.received_at DESC)
      FROM (
        SELECT * FROM catho_private.sponsor_payment_transactions
        WHERE sponsor_id = p_sponsor_id ORDER BY received_at DESC LIMIT 200
      ) AS transaction
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_financials(uuid, uuid) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_sponsor_financials(p_actor_user_id uuid, p_sponsor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id AND membership.user_id = p_actor_user_id
      AND membership.status = 'active'
  ) THEN RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', invoice.id, 'invoice_number', invoice.invoice_number, 'description', invoice.description,
        'amount_minor', invoice.amount_minor, 'currency', invoice.currency,
        'issued_on', invoice.issued_on, 'due_on', invoice.due_on, 'status', invoice.status,
        'paid_minor', invoice.paid_minor, 'balance_minor', greatest(invoice.amount_minor - invoice.paid_minor, 0)
      ) ORDER BY invoice.created_at DESC)
      FROM (
        SELECT inv.*, coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
          THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0) AS paid_minor
        FROM catho_private.sponsor_invoices AS inv
        LEFT JOIN catho_private.sponsor_payment_transactions AS transaction ON transaction.invoice_id = inv.id
        WHERE inv.sponsor_id = p_sponsor_id
        GROUP BY inv.id ORDER BY inv.created_at DESC LIMIT 100
      ) AS invoice
    ), '[]'::jsonb),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', transaction.id, 'invoice_id', transaction.invoice_id,
        'transaction_type', transaction.transaction_type, 'amount_minor', transaction.amount_minor,
        'currency', transaction.currency, 'bank_reference', transaction.bank_reference,
        'bank_transaction_date', transaction.bank_transaction_date,
        'received_at', transaction.received_at
      ) ORDER BY transaction.received_at DESC)
      FROM (
        SELECT * FROM catho_private.sponsor_payment_transactions
        WHERE sponsor_id = p_sponsor_id ORDER BY received_at DESC LIMIT 200
      ) AS transaction
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_financials(uuid, uuid) OWNER TO postgres;
-- Applied migration: enforce_invoice_based_sponsor_reconciliation


ALTER FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text) OWNER TO postgres;



-- Applied migration: add_admin_sponsor_account_lookup

CREATE OR REPLACE FUNCTION public.admin_find_sponsor_user_by_email(p_actor_user_id uuid, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
-- Applied migration: enforce_sponsor_invoice_agreement_currency


-- Applied migration: scope_sponsor_refunds_and_prevent_owner_lockout


CREATE OR REPLACE FUNCTION public.admin_record_sponsor_refund(p_actor_user_id uuid, p_sponsor_id uuid, p_payment_id uuid, p_amount_minor bigint, p_bank_reference text DEFAULT NULL::text, p_bank_transaction_date date DEFAULT NULL::date, p_bank_transaction_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_payment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_payment_transactions AS payment
    WHERE payment.id = p_payment_id AND payment.sponsor_id = p_sponsor_id
      AND payment.transaction_type = 'payment'
  ) THEN RAISE EXCEPTION 'Original payment not found for this sponsor' USING ERRCODE = 'P0002'; END IF;
  RETURN public.admin_record_sponsor_refund(
    p_actor_user_id, p_payment_id, p_amount_minor,
    p_bank_reference, p_bank_transaction_date, p_bank_transaction_key
  );
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text) OWNER TO postgres;
-- Applied migration: prevent_unpaid_sponsor_from_bypassing_invoice_reconciliation


-- Applied migration: index_sponsor_platform_foreign_keys

CREATE INDEX sponsor_invoices_created_by_idx
  ON catho_private.sponsor_invoices (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX sponsor_member_audit_actor_created_idx
  ON catho_private.sponsor_member_audit (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX sponsor_member_audit_campaign_idx
  ON catho_private.sponsor_member_audit (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX sponsor_member_audit_target_user_idx
  ON catho_private.sponsor_member_audit (target_user_id)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX sponsor_payment_transactions_recorded_by_idx
  ON catho_private.sponsor_payment_transactions (recorded_by, received_at DESC)
  WHERE recorded_by IS NOT NULL;
CREATE INDEX sponsor_memberships_added_by_idx
  ON public.sponsor_memberships (added_by)
  WHERE added_by IS NOT NULL;

-- Applied migration: add_admin_sponsor_status_controls

CREATE OR REPLACE FUNCTION public.admin_set_sponsor_status(p_actor_user_id uuid, p_sponsor_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('draft', 'scheduled', 'active', 'paused', 'completed') THEN
    RAISE EXCEPTION 'Invalid sponsor status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sponsors SET status = p_status, updated_at = statement_timestamp()
  WHERE id = p_sponsor_id RETURNING * INTO v_sponsor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.status_changed', 'sponsor', v_sponsor.id::text,
    jsonb_build_object('sponsor_name', v_sponsor.sponsor_name, 'status', v_sponsor.status));
  RETURN jsonb_build_object('id', v_sponsor.id, 'sponsor_name', v_sponsor.sponsor_name,
    'status', v_sponsor.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_status(uuid, uuid, text) OWNER TO postgres;
-- Applied migration: add_feed_card_analytics

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
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists (
    select 1 from catho_private.user_analytics_consents as consent
    where consent.user_id = v_user_id and consent.service_improvement = true
  ) then return 0; end if;
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
CREATE OR REPLACE FUNCTION catho_private.prune_feed_card_analytics_events(p_before timestamp with time zone, p_batch_size integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_deleted integer; v_viewers_deleted integer;
begin
  if p_before>statement_timestamp()-interval '180 days' or p_batch_size not between 1 and 5000 then
    raise exception 'invalid retention boundary or batch size' using errcode='22023';
  end if;
  with doomed as (
    select ctid from catho_private.feed_card_analytics_daily_viewers
    where event_date<p_before::date order by event_date limit p_batch_size
  )
  delete from catho_private.feed_card_analytics_daily_viewers v using doomed d where v.ctid=d.ctid;
  get diagnostics v_viewers_deleted=row_count;
  with doomed as (
    select ctid from catho_private.feed_card_analytics_events
    where received_at<p_before order by received_at limit p_batch_size
  )
  delete from catho_private.feed_card_analytics_events e using doomed d where e.ctid=d.ctid;
  get diagnostics v_deleted=row_count;
  return v_deleted+v_viewers_deleted;
end;
$function$;
ALTER FUNCTION catho_private.prune_feed_card_analytics_events(timestamptz,integer) OWNER TO postgres;
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
    or p_to > statement_timestamp()+interval '1 day' then raise exception 'invalid analytics range' using errcode='22023'; end if;
  with topic_daily as (
    select entity_id,event_date,impressions,viewable_impressions,active_duration_ms,skips,completions,return_visits
    from catho_private.feed_analytics_daily where event_date >= p_from::date and event_date <= p_to::date
  ), sponsor_daily as (
    select campaign_id,event_date,served_count,viewable_impressions,clicks
    from catho_private.sponsor_campaign_daily where event_date >= p_from::date and event_date <= p_to::date
  ), comment_daily as (
    select card_id,event_date,impressions,viewable_impressions,active_duration_ms,skips,completions,opens,unique_viewers
    from catho_private.feed_card_analytics_daily where event_date >= p_from::date and event_date <= p_to::date
  ), totals as (
    select coalesce((select sum(impressions) from topic_daily),0) topic_impressions,
      coalesce((select sum(viewable_impressions) from topic_daily),0) topic_viewable_impressions,
      coalesce((select sum(active_duration_ms) from topic_daily),0) topic_active_duration_ms,
      coalesce((select sum(skips) from topic_daily),0) topic_skips,
      coalesce((select sum(completions) from topic_daily),0) topic_completions,
      coalesce((select sum(served_count) from sponsor_daily),0) sponsor_served,
      coalesce((select sum(viewable_impressions) from sponsor_daily),0) sponsor_viewable_impressions,
      coalesce((select sum(clicks) from sponsor_daily),0) sponsor_clicks,
      coalesce((select sum(impressions) from comment_daily),0) comment_card_impressions,
      coalesce((select sum(viewable_impressions) from comment_daily),0) comment_card_viewable_impressions,
      coalesce((select sum(active_duration_ms) from comment_daily),0) comment_card_active_duration_ms,
      coalesce((select sum(skips) from comment_daily),0) comment_card_skips,
      coalesce((select sum(opens) from comment_daily),0) comment_card_opens,
      (select count(*) from public.categories) category_count,
      (select count(*) from public.topics) topic_count,
      (select count(*) from public.sponsors) sponsor_count,
      (select count(*) from public.comments where is_deleted=false and parent_id is null) comment_count,
      (select count(*) from public.topic_likes where created_at>=p_from and created_at<p_to) topic_likes,
      (select count(*) from public.bookmarks where created_at>=p_from and created_at<p_to) bookmarks,
      (select count(*) from public.progress where completed_at>=p_from and completed_at<p_to) completed_topics,
      (select count(*) from public.comments where parent_id is null and is_deleted=false and created_at>=p_from and created_at<p_to) comments_created,
      (select count(*) from public.comments where parent_id is not null and is_deleted=false and created_at>=p_from and created_at<p_to) replies,
      (select count(*) from public.comment_likes where created_at>=p_from and created_at<p_to) comment_likes,
      (select count(distinct user_id) from catho_private.feed_analytics_events where entity_type='topic' and event_type in ('impression','viewable_impression') and received_at>=p_from and received_at<p_to) unique_topic_viewers,
      (select count(distinct user_id) from catho_private.sponsor_campaign_events where event_type in ('served','viewable_impression') and received_at>=p_from and received_at<p_to) unique_sponsor_viewers,
      (select count(distinct user_id) from catho_private.feed_card_analytics_events where event_type in ('impression','viewable_impression') and received_at>=p_from and received_at<p_to) unique_comment_viewers,
      (select count(distinct user_id) from (
        select user_id from catho_private.feed_analytics_events where entity_type='topic' and event_type in ('impression','viewable_impression') and received_at>=p_from and received_at<p_to
        union select user_id from catho_private.sponsor_campaign_events where event_type in ('served','viewable_impression') and received_at>=p_from and received_at<p_to
        union select user_id from catho_private.feed_card_analytics_events where event_type in ('impression','viewable_impression') and received_at>=p_from and received_at<p_to
      ) all_viewers) unique_feed_viewers
  ), categories as (
    select c.slug,c.name,count(t.id) topic_count,coalesce(sum(td.impressions),0) impressions,coalesce(sum(td.viewable_impressions),0) viewable_impressions
    from public.categories c left join public.topics t on t.category_slug=c.slug
    left join topic_daily td on td.entity_id=t.id group by c.slug,c.name order by impressions desc,c.name
  ), topics as (
    select t.id,t.slug,t.question,t.category_slug,coalesce(sum(td.impressions),0) impressions,
      coalesce(sum(td.viewable_impressions),0) viewable_impressions,coalesce(sum(td.active_duration_ms),0) active_duration_ms
    from public.topics t left join topic_daily td on td.entity_id=t.id
    group by t.id,t.slug,t.question,t.category_slug order by impressions desc,t.question
  ), sponsors as (
    select s.id,s.sponsor_name,s.status,count(distinct sc.id) campaign_count,
      coalesce(sum(sd.served_count),0) served,coalesce(sum(sd.viewable_impressions),0) viewable_impressions,coalesce(sum(sd.clicks),0) clicks
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id group by s.id,s.sponsor_name,s.status order by served desc,s.sponsor_name
  ), comments as (
    select c.id,c.topic_id,t.question topic_question,c.created_at,coalesce(cd.impressions,0) impressions,
      coalesce(cd.viewable_impressions,0) viewable_impressions,coalesce(cd.active_duration_ms,0) active_duration_ms,
      coalesce(cd.skips,0) skips,coalesce(cd.opens,0) opens,
      (select count(*) from public.comment_likes cl where cl.comment_id=c.id and cl.created_at>=p_from and cl.created_at<p_to) likes,
      (select count(*) from public.comments r where r.parent_id=c.id and r.is_deleted=false and r.created_at>=p_from and r.created_at<p_to) replies
    from public.comments c left join public.topics t on t.id=c.topic_id
    left join (select card_id,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions,
      sum(active_duration_ms) active_duration_ms,sum(skips) skips,sum(opens) opens from comment_daily group by card_id) cd
      on cd.card_id=c.id::text
    where c.parent_id is null and c.is_deleted=false order by impressions desc,c.created_at desc
  )
  select jsonb_build_object('totals',(select to_jsonb(totals) from totals),
    'categories',(select coalesce(jsonb_agg(to_jsonb(categories)),'[]'::jsonb) from categories),
    'topics',(select coalesce(jsonb_agg(to_jsonb(topics)),'[]'::jsonb) from topics),
    'sponsors',(select coalesce(jsonb_agg(to_jsonb(sponsors)),'[]'::jsonb) from sponsors),
    'comments',(select coalesce(jsonb_agg(to_jsonb(comments)),'[]'::jsonb) from comments)) into v_result;
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_analytics_overview(uuid,timestamptz,timestamptz) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_admin_sponsor_analytics(p_actor_user_id uuid, p_sponsor_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
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
  if p_sponsor_id is null or p_from is null or p_to is null or p_to <= p_from or p_to-p_from > interval '180 days' then
    raise exception 'invalid sponsor analytics range' using errcode='22023';
  end if;
  if not exists(select 1 from public.sponsors where id=p_sponsor_id) then raise exception 'sponsor not found' using errcode='P0002'; end if;
  with campaigns as (select id,campaign_name,status from public.sponsor_campaigns where sponsor_id=p_sponsor_id),
  metrics as (
    select coalesce(sum(d.served_count),0) served,coalesce(sum(d.viewable_impressions),0) viewable_impressions,
      coalesce(sum(d.clicks),0) clicks,count(distinct d.campaign_id) filter(where d.served_count>0) active_campaigns
    from catho_private.sponsor_campaign_daily d join campaigns c on c.id=d.campaign_id
    where d.event_date>=p_from::date and d.event_date<=p_to::date
  ), series as (
    select d.event_date,coalesce(sum(d.served_count),0) served,coalesce(sum(d.viewable_impressions),0) viewable_impressions,
      coalesce(sum(d.clicks),0) clicks from catho_private.sponsor_campaign_daily d join campaigns c on c.id=d.campaign_id
    where d.event_date>=p_from::date and d.event_date<=p_to::date group by d.event_date order by d.event_date
  )
  select jsonb_build_object('sponsor_id',p_sponsor_id,'totals',(select to_jsonb(metrics) from metrics),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.campaign_name,'status',c.status)),'[]'::jsonb) from campaigns c),
    'series',(select coalesce(jsonb_agg(to_jsonb(series)),'[]'::jsonb) from series)) into v_result;
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_sponsor_analytics(uuid,uuid,timestamptz,timestamptz) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_admin_feed_card_analytics(p_actor_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_card_type text, p_card_id text)
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
    or p_card_type<>'top-comment' or p_card_id is null or length(p_card_id) not between 1 and 64 then
    raise exception 'invalid comment analytics range or filter' using errcode='22023';
  end if;
  with daily as (
    select * from catho_private.feed_card_analytics_daily
    where card_type=p_card_type and card_id=p_card_id and event_date>=p_from::date and event_date<=p_to::date
  ), totals as (
    select coalesce(sum(impressions),0) impressions,coalesce(sum(viewable_impressions),0) viewable_impressions,
      coalesce(sum(active_duration_ms),0) active_duration_ms,coalesce(sum(skips),0) skips,
      coalesce(sum(completions),0) completions,coalesce(sum(opens),0) opens,
      coalesce(sum(unique_viewers),0) unique_viewers from daily
  ), series as (
    select event_date,impressions,viewable_impressions,active_duration_ms,skips,opens from daily order by event_date
  )
  select jsonb_build_object('totals',(select to_jsonb(totals) from totals),
    'series',(select coalesce(jsonb_agg(to_jsonb(series)),'[]'::jsonb) from series)) into v_result;
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_feed_card_analytics(uuid,timestamptz,timestamptz,text,text) OWNER TO postgres;
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
    select event_date,sum(served_count) served,sum(viewable_impressions) viewable_impressions,sum(clicks) clicks
    from catho_private.sponsor_campaign_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  ), comments as (
    select event_date,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions
    from catho_private.feed_card_analytics_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_date',d.event_date,
    'topic_impressions',coalesce(t.impressions,0),'topic_viewable_impressions',coalesce(t.viewable_impressions,0),
    'sponsor_served',coalesce(s.served,0),'sponsor_viewable_impressions',coalesce(s.viewable_impressions,0),
    'sponsor_clicks',coalesce(s.clicks,0),'comment_impressions',coalesce(c.impressions,0),
    'comment_viewable_impressions',coalesce(c.viewable_impressions,0)) order by d.event_date),'[]'::jsonb)
  into v_result from days d left join topic t using(event_date) left join sponsor s using(event_date) left join comments c using(event_date);
  return v_result;
end;
$function$;
ALTER FUNCTION public.get_admin_analytics_series(uuid,timestamptz,timestamptz) OWNER TO postgres;
DO $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='cathoscroll-rollup-feed-card-analytics') THEN
    PERFORM cron.schedule('cathoscroll-rollup-feed-card-analytics','*/5 * * * *','SELECT catho_private.refresh_feed_card_analytics_daily();');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='cathoscroll-prune-feed-card-analytics') THEN
    PERFORM cron.schedule('cathoscroll-prune-feed-card-analytics','*/15 * * * *',
      'SELECT catho_private.prune_feed_card_analytics_events(statement_timestamp() - interval ''180 days'', 5000);');
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- End of CathoScroll application-schema and catalogue bootstrap.


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
DROP TRIGGER IF EXISTS cathoscroll_capture_signup_personalization_consent ON auth.users;
CREATE TRIGGER cathoscroll_capture_signup_personalization_consent
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION catho_private.capture_signup_personalization_consent();


-- Production overloads added after the previous emergency snapshot.
CREATE OR REPLACE FUNCTION public.admin_create_sponsor(p_actor_user_id uuid, p_sponsor_name text, p_contact_email text, p_website_url text, p_logo_url text, p_description text, p_starts_on date, p_ends_on date, p_status text, p_agreed_amount_minor bigint, p_currency text, p_payment_status text, p_payment_reference text, p_admin_notes text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.admin_create_sponsor(
    p_actor_user_id,
    p_sponsor_name,
    p_contact_email,
    p_website_url,
    p_description,
    p_starts_on,
    p_ends_on,
    p_status,
    p_agreed_amount_minor,
    p_currency,
    p_payment_status,
    p_payment_reference,
    p_admin_notes
  );
$function$;

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
    select d.campaign_id,d.event_date,d.served_count,d.viewable_impressions,d.clicks
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
      coalesce((select sum(served_count) from sponsor_daily),0) sponsor_served,
      coalesce((select sum(viewable_impressions) from sponsor_daily),0) sponsor_viewable_impressions,
      coalesce((select sum(clicks) from sponsor_daily),0) sponsor_clicks,
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
      coalesce(sum(sd.served_count),0) served,coalesce(sum(sd.viewable_impressions),0) viewable_impressions,
      coalesce(sum(sd.clicks),0) clicks
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id
    group by s.id,s.sponsor_name,s.status
    order by served desc,s.sponsor_name
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

CREATE OR REPLACE FUNCTION public.get_admin_feed_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_card_type text DEFAULT NULL::text, p_card_id text DEFAULT NULL::text)
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
    or (p_card_type is not null and p_card_type <> 'top-comment')
    or (p_card_id is not null and (length(p_card_id) not between 1 and 64 or p_card_type is null)) then
    raise exception 'invalid analytics range or filter' using errcode='22023';
  end if;
  with days as (
    select d::date as event_date from generate_series(date_trunc('day',p_from),date_trunc('day',p_to),interval '1 day') d
  ), daily as (
    select * from catho_private.feed_card_analytics_daily
    where event_date >= p_from::date and event_date <= p_to::date
      and (p_card_type is null or card_type=p_card_type)
      and (p_card_id is null or card_id=p_card_id)
  ), totals as (
    select coalesce(sum(impressions),0) impressions,coalesce(sum(viewable_impressions),0) viewable_impressions,
      coalesce(sum(active_duration_ms),0) active_duration_ms,coalesce(sum(skips),0) skips,
      coalesce(sum(completions),0) completions,coalesce(sum(opens),0) opens,
      coalesce(sum(unique_viewers),0) unique_viewers,
      max(refreshed_at) last_refreshed_at
    from daily
  ), series as (
    select d.event_date,coalesce(sum(a.impressions),0) impressions,
      coalesce(sum(a.viewable_impressions),0) viewable_impressions,
      coalesce(sum(a.active_duration_ms),0) active_duration_ms,
      coalesce(sum(a.skips),0) skips
    from days d left join daily a on a.event_date=d.event_date
    group by d.event_date order by d.event_date
  ), top_cards as (
    select card_id, sum(impressions) impressions,sum(viewable_impressions) viewable_impressions,
      sum(active_duration_ms) active_duration_ms,sum(skips) skips,sum(completions) completions,sum(opens) opens
    from daily group by card_id order by sum(impressions) desc limit 100
  )
  select jsonb_build_object(
    'range_start',p_from,'range_end',p_to,
    'totals',(select to_jsonb(totals) from totals),
    'series',(select coalesce(jsonb_agg(to_jsonb(series)),'[]'::jsonb) from series),
    'top_cards',(select coalesce(jsonb_agg(to_jsonb(top_cards)),'[]'::jsonb) from top_cards)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_sponsor_analytics(p_sponsor_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
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
  if p_sponsor_id is null or p_from is null or p_to is null or p_to <= p_from
    or p_to-p_from > interval '180 days' then
    raise exception 'invalid sponsor analytics range' using errcode='22023';
  end if;
  if not exists(select 1 from public.sponsors where id=p_sponsor_id) then
    raise exception 'sponsor not found' using errcode='P0002';
  end if;
  with campaigns as (
    select id,campaign_name,status from public.sponsor_campaigns where sponsor_id=p_sponsor_id
  ), metrics as (
    select coalesce(sum(d.served_count),0) served,
      coalesce(sum(d.viewable_impressions),0) viewable_impressions,
      coalesce(sum(d.clicks),0) clicks,
      count(distinct d.campaign_id) filter(where d.served_count > 0) active_campaigns
    from catho_private.sponsor_campaign_daily d join campaigns c on c.id=d.campaign_id
    where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), series as (
    select d.event_date,coalesce(sum(d.served_count),0) served,
      coalesce(sum(d.viewable_impressions),0) viewable_impressions,coalesce(sum(d.clicks),0) clicks
    from catho_private.sponsor_campaign_daily d join campaigns c on c.id=d.campaign_id
    where d.event_date >= p_from::date and d.event_date <= p_to::date
    group by d.event_date order by d.event_date
  )
  select jsonb_build_object(
    'sponsor_id',p_sponsor_id,
    'totals',(select to_jsonb(metrics) from metrics),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.campaign_name,'status',c.status)),'[]'::jsonb) from campaigns c),
    'series',(select coalesce(jsonb_agg(to_jsonb(series)),'[]'::jsonb) from series)
  ) into v_result;
  return v_result;
end;
$function$;



-- Exact ACLs for the added overloads.


-- Exact function privileges from the live production catalog (owner privileges are implicit).
REVOKE ALL ON FUNCTION catho_private.activity_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.audit_moderation_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.capture_signup_personalization_consent() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.consume_recommendation_rate_limit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.consume_recommendation_rate_limit(uuid) TO authenticated;
REVOKE ALL ON FUNCTION catho_private.enforce_activity_mutation_rate_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.enforce_user_action_rate_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.get_user_feed_preference_signals(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.get_user_feed_preference_signals(uuid) TO authenticated;
REVOKE ALL ON FUNCTION catho_private.is_cathoscroll_content_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.is_cathoscroll_content_admin() TO anon;
GRANT EXECUTE ON FUNCTION catho_private.is_cathoscroll_content_admin() TO authenticated;
REVOKE ALL ON FUNCTION catho_private.prevent_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_activity(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_due_activity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_feed_analytics_events(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_feed_card_analytics_events(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_old_activity(uuid, timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_sponsor_campaign_events(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.record_activity(uuid, text, text, boolean, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.refresh_feed_analytics_daily(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.refresh_feed_analytics_daily(integer) TO service_role;
REVOKE ALL ON FUNCTION catho_private.refresh_feed_card_analytics_daily() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.refresh_user_interest_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.validate_comment_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.validate_notification_read_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.validate_notification_read_update() TO PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_sponsor_member(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_sponsor_member(uuid, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, date, date, text, bigint, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsor_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_find_sponsor_user_by_email(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_find_sponsor_user_by_email(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_get_action_audit(uuid, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_action_audit(uuid, bigint, integer) TO service_role;
REVOKE ALL ON FUNCTION public.admin_manage_comment_ban(uuid, uuid, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_manage_comment_ban(uuid, uuid, text, text, boolean, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_mark_sponsor_payment_received(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, uuid, bigint, text, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_review_comment_ban_appeal(bigint, boolean, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_comment_ban_appeal(bigint, boolean, uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_review_comment_report(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_comment_report(bigint, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_comment_pin(bigint, boolean, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_comment_pin(bigint, boolean, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_campaign_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_campaign_status(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_member_status(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_status(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_analytics_deep_dive(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_deep_dive(uuid, timestamp with time zone, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_analytics_overview(timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_analytics_series(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_series(uuid, timestamp with time zone, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_content_analytics(text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_content_analytics(text, text, timestamp with time zone, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_feed_analytics(timestamp with time zone, timestamp with time zone, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_feed_card_analytics(uuid, timestamp with time zone, timestamp with time zone, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_feed_card_analytics(uuid, timestamp with time zone, timestamp with time zone, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_analytics(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamp with time zone, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_financials(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_financials(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_my_personalization_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_personalization_status() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_recommendation_page(jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(jsonb, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_my_topic_engagement() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_topic_engagement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_topic_engagement() TO service_role;
REVOKE ALL ON FUNCTION public.get_public_profile_metrics(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_profile_metrics(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_metrics(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role;
REVOKE ALL ON FUNCTION public.get_sponsor_financials(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_financials(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_top_feed_comments(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_feed_comments(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_topic_comment_page(text, timestamp with time zone, bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_topic_comment_page(text, timestamp with time zone, bigint, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_topic_comment_page(text, timestamp with time zone, bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_topic_like_state(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_topic_like_state(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_topic_like_state(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.is_cathoscroll_admin_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_admin_owner(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_cathoscroll_content_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_content_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_content_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.notify_comment_appeal_reviewed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_pin_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_reply() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_report_reviewed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_restriction_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_restriction_lifted() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_moderated_comment_visibility() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_profile_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_activity_changes(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_activity_changes(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_changes(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.offline_activity_head(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_activity_head(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_head(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.offline_activity_snapshot(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_activity_snapshot(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_snapshot(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.offline_apply_activity(uuid, uuid, text, text, boolean, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity(uuid, uuid, text, text, boolean, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.offline_apply_activity_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_batch(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.offline_apply_activity_v2(uuid, uuid, uuid, text, text, text, text, boolean, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_v2(uuid, uuid, uuid, text, text, text, text, boolean, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_v2(uuid, uuid, uuid, text, text, text, text, boolean, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_category_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_changes(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_head() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_lock() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_prune(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_prune(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_prune_old(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_prune_old(timestamp with time zone, integer) TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_record(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_record(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_topic_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_truncated() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_feed_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_analytics_events(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.record_feed_card_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_card_analytics_events(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.reject_comment_edit_from_banned_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_comment_from_banned_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_published_topics(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_published_topics(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_published_topics(text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.set_content_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.set_my_personalization_consent(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_consent(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.set_my_personalization_interests(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_interests(text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.sponsor_create_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_create_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.sponsor_update_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sponsor_update_campaign(uuid, uuid, text, text, text, text, text, text, date, date, text[], text[], integer, integer, integer, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.submit_comment_report(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_comment_report(uuid, bigint, text, text) TO service_role;

-- Public analytics-ranked general feed. Mirrors the live production function.
-- Uses aggregate site-wide engagement and public content interactions only.
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
              UNION ALL
              SELECT a.event_date,a.viewable_impressions,a.impressions,a.completions,a.active_duration_ms,a.skips,a.entity_id
              FROM catho_private.anonymous_feed_analytics_daily a
              WHERE a.entity_type='topic'
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
              UNION ALL
              SELECT a.event_date,a.viewable_impressions,a.impressions,a.completions,a.active_duration_ms,a.skips,a.entity_id
              FROM catho_private.anonymous_feed_analytics_daily a
              WHERE a.entity_type='topic'
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
 
-- ANONYMOUS ANALYTICS ROLLOUT
-- Signed-out topic/comment analytics are stored only as daily entity aggregates.
-- Sponsor frequency uses an in-memory session token hashed before storage.
-- Anonymous sponsor raw events, frequency rows and analytics receipts are pruned after 30 days.
CREATE TABLE catho_private.anonymous_feed_analytics_daily (
  event_date date NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('topic','comment')),
  entity_id text NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  viewable_impressions bigint NOT NULL DEFAULT 0,
  active_duration_ms bigint NOT NULL DEFAULT 0,
  skips bigint NOT NULL DEFAULT 0,
  completions bigint NOT NULL DEFAULT 0,
  opens bigint NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(event_date,entity_type,entity_id)
);
CREATE TABLE catho_private.anonymous_feed_event_receipts (
  event_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX anonymous_feed_event_receipts_received_at_idx
  ON catho_private.anonymous_feed_event_receipts(received_at);
CREATE TABLE catho_private.anonymous_sponsor_session_frequency (
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  served_count integer NOT NULL DEFAULT 0 CHECK (served_count>=0),
  last_served_at timestamptz NOT NULL,
  PRIMARY KEY(campaign_id,session_hash)
);
CREATE TABLE catho_private.anonymous_sponsor_events (
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  placement_id text NOT NULL CHECK (length(placement_id) BETWEEN 1 AND 160),
  event_type text NOT NULL CHECK (event_type IN ('served','viewable_impression','click')),
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(campaign_id,event_id)
);
CREATE INDEX anonymous_sponsor_events_recent_idx
  ON catho_private.anonymous_sponsor_events(campaign_id,event_type,received_at);
CREATE INDEX anonymous_sponsor_events_placement_idx
  ON catho_private.anonymous_sponsor_events(campaign_id,session_hash,placement_id,event_type,received_at);
CREATE TABLE catho_private.anonymous_sponsor_campaign_daily (
  event_date date NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  served_count bigint NOT NULL DEFAULT 0,
  viewable_impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(event_date,campaign_id)
);
CREATE INDEX IF NOT EXISTS anonymous_sponsor_campaign_daily_campaign_id_idx ON catho_private.anonymous_sponsor_campaign_daily(campaign_id);
CREATE INDEX IF NOT EXISTS anonymous_sponsor_events_received_at_idx ON catho_private.anonymous_sponsor_events(received_at);
CREATE INDEX IF NOT EXISTS anonymous_sponsor_session_frequency_last_served_at_idx ON catho_private.anonymous_sponsor_session_frequency(last_served_at);
ALTER TABLE catho_private.anonymous_feed_analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.anonymous_feed_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.anonymous_sponsor_session_frequency ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.anonymous_sponsor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.anonymous_sponsor_campaign_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE catho_private.anonymous_feed_analytics_daily,
  catho_private.anonymous_feed_event_receipts,
  catho_private.anonymous_sponsor_session_frequency,
  catho_private.anonymous_sponsor_events,
  catho_private.anonymous_sponsor_campaign_daily FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_admin_anonymous_analytics(p_actor_user_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_entity_type text DEFAULT 'all'::text, p_entity_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_topic_ids text[] := ARRAY[]::text[];
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_comment_ids text[] := ARRAY[]::text[];
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.user_id=p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '180 days'
    OR p_to>statement_timestamp()+interval '1 day'
    OR p_entity_type IS NULL OR p_entity_type NOT IN ('all','topic','category','comment','sponsor')
    OR (p_entity_type<>'all' AND (p_entity_id IS NULL OR length(p_entity_id) NOT BETWEEN 1 AND 160)) THEN
    RAISE EXCEPTION 'invalid anonymous analytics range or filter' USING ERRCODE='22023';
  END IF;

  IF p_entity_type='topic' THEN
    SELECT coalesce(array_agg(t.id),ARRAY[]::text[]) INTO v_topic_ids
    FROM public.topics t WHERE t.slug=p_entity_id;
    IF cardinality(v_topic_ids)=0 THEN RAISE EXCEPTION 'analytics topic not found' USING ERRCODE='P0002'; END IF;
  ELSIF p_entity_type='category' THEN
    IF NOT EXISTS(SELECT 1 FROM public.categories c WHERE c.slug=p_entity_id) THEN
      RAISE EXCEPTION 'analytics category not found' USING ERRCODE='P0002';
    END IF;
    SELECT coalesce(array_agg(t.id),ARRAY[]::text[]) INTO v_topic_ids
    FROM public.topics t WHERE t.category_slug=p_entity_id;
  ELSIF p_entity_type='comment' THEN
    IF p_entity_id !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'invalid comment analytics ID' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.comments c WHERE c.id=p_entity_id::bigint AND c.parent_id IS NULL AND c.is_deleted=false) THEN
      RAISE EXCEPTION 'analytics comment not found' USING ERRCODE='P0002';
    END IF;
    v_comment_ids:=ARRAY[p_entity_id];
  ELSIF p_entity_type='sponsor' THEN
    IF p_entity_id !~* '^[0-9a-f-]{36}$' OR NOT EXISTS(SELECT 1 FROM public.sponsors s WHERE s.id=p_entity_id::uuid) THEN
      RAISE EXCEPTION 'analytics sponsor not found' USING ERRCODE='P0002';
    END IF;
    SELECT coalesce(array_agg(c.id),ARRAY[]::uuid[]) INTO v_campaign_ids
    FROM public.sponsor_campaigns c WHERE c.sponsor_id=p_entity_id::uuid;
  ELSE
    SELECT coalesce(array_agg(t.id),ARRAY[]::text[]) INTO v_topic_ids FROM public.topics t;
    SELECT coalesce(array_agg(c.id),ARRAY[]::uuid[]) INTO v_campaign_ids FROM public.sponsor_campaigns c;
    SELECT coalesce(array_agg(c.id::text),ARRAY[]::text[]) INTO v_comment_ids
    FROM public.comments c WHERE c.parent_id IS NULL AND c.is_deleted=false;
  END IF;

  WITH days AS (
    SELECT d::date event_date
    FROM generate_series(p_from::date,p_to::date,interval '1 day') d
  ), topic_daily AS (
    SELECT d.event_date,sum(d.impressions) impressions,sum(d.viewable_impressions) viewable_impressions,
      sum(d.active_duration_ms) active_duration_ms,sum(d.skips) skips,sum(d.completions) completions
    FROM catho_private.anonymous_feed_analytics_daily d
    WHERE d.entity_type='topic' AND d.entity_id=ANY(v_topic_ids)
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    GROUP BY d.event_date
  ), comment_daily AS (
    SELECT d.event_date,sum(d.impressions) impressions,sum(d.viewable_impressions) viewable_impressions,
      sum(d.active_duration_ms) active_duration_ms,sum(d.skips) skips,sum(d.completions) completions,sum(d.opens) opens
    FROM catho_private.anonymous_feed_analytics_daily d
    WHERE d.entity_type='comment' AND d.entity_id=ANY(v_comment_ids)
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    GROUP BY d.event_date
  ), sponsor_daily AS (
    SELECT d.event_date,sum(d.served_count) served,sum(d.viewable_impressions) viewable_impressions,sum(d.clicks) clicks
    FROM catho_private.anonymous_sponsor_campaign_daily d
    WHERE d.campaign_id=ANY(v_campaign_ids) AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    GROUP BY d.event_date
  ), topic_entities AS (
    SELECT t.id,t.slug,t.question,t.category_slug,
      coalesce(sum(d.impressions),0) impressions,coalesce(sum(d.viewable_impressions),0) viewable_impressions,
      coalesce(sum(d.active_duration_ms),0) active_duration_ms
    FROM public.topics t LEFT JOIN catho_private.anonymous_feed_analytics_daily d
      ON d.entity_type='topic' AND d.entity_id=t.id AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    WHERE t.id=ANY(v_topic_ids) GROUP BY t.id,t.slug,t.question,t.category_slug
  ), category_entities AS (
    SELECT c.slug,c.name,count(t.id) topic_count,coalesce(sum(d.impressions),0) impressions,
      coalesce(sum(d.viewable_impressions),0) viewable_impressions
    FROM public.categories c LEFT JOIN public.topics t ON t.category_slug=c.slug
    LEFT JOIN catho_private.anonymous_feed_analytics_daily d ON d.entity_type='topic' AND d.entity_id=t.id
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    WHERE p_entity_type='all' OR (p_entity_type='category' AND c.slug=p_entity_id)
    GROUP BY c.slug,c.name
  ), sponsor_entities AS (
    SELECT s.id,s.sponsor_name,coalesce(sum(d.served_count),0) served,
      coalesce(sum(d.viewable_impressions),0) viewable_impressions,coalesce(sum(d.clicks),0) clicks
    FROM public.sponsors s LEFT JOIN public.sponsor_campaigns c ON c.sponsor_id=s.id
    LEFT JOIN catho_private.anonymous_sponsor_campaign_daily d ON d.campaign_id=c.id
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    WHERE p_entity_type='all' OR (p_entity_type='sponsor' AND s.id=p_entity_id::uuid)
    GROUP BY s.id,s.sponsor_name
  ), comment_entities AS (
    SELECT c.id::text id,coalesce(sum(d.impressions),0) impressions,
      coalesce(sum(d.viewable_impressions),0) viewable_impressions,
      coalesce(sum(d.active_duration_ms),0) active_duration_ms,
      coalesce(sum(d.skips),0) skips,coalesce(sum(d.completions),0) completions,
      coalesce(sum(d.opens),0) opens
    FROM public.comments c LEFT JOIN catho_private.anonymous_feed_analytics_daily d
      ON d.entity_type='comment' AND d.entity_id=c.id::text
      AND d.event_date>=p_from::date AND d.event_date<=p_to::date
    WHERE c.parent_id IS NULL AND c.is_deleted=false AND c.id::text=ANY(v_comment_ids)
    GROUP BY c.id
  ), totals AS (
    SELECT
      coalesce((SELECT sum(impressions) FROM topic_daily),0) topic_impressions,
      coalesce((SELECT sum(viewable_impressions) FROM topic_daily),0) topic_viewable_impressions,
      coalesce((SELECT sum(active_duration_ms) FROM topic_daily),0) topic_active_duration_ms,
      coalesce((SELECT sum(skips) FROM topic_daily),0) topic_skips,
      coalesce((SELECT sum(completions) FROM topic_daily),0) topic_completions,
      coalesce((SELECT sum(impressions) FROM comment_daily),0) comment_card_impressions,
      coalesce((SELECT sum(viewable_impressions) FROM comment_daily),0) comment_card_viewable_impressions,
      coalesce((SELECT sum(active_duration_ms) FROM comment_daily),0) comment_card_active_duration_ms,
      coalesce((SELECT sum(skips) FROM comment_daily),0) comment_card_skips,
      coalesce((SELECT sum(completions) FROM comment_daily),0) comment_card_completions,
      coalesce((SELECT sum(opens) FROM comment_daily),0) comment_card_opens,
      coalesce((SELECT sum(served) FROM sponsor_daily),0) sponsor_served,
      coalesce((SELECT sum(viewable_impressions) FROM sponsor_daily),0) sponsor_viewable_impressions,
      coalesce((SELECT sum(clicks) FROM sponsor_daily),0) sponsor_clicks
  )
  SELECT jsonb_build_object(
    'totals',(SELECT to_jsonb(totals) FROM totals),
    'series',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'event_date',days.event_date,
      'topic_impressions',coalesce(topic_daily.impressions,0),
      'topic_viewable_impressions',coalesce(topic_daily.viewable_impressions,0),
      'comment_impressions',coalesce(comment_daily.impressions,0),
      'comment_viewable_impressions',coalesce(comment_daily.viewable_impressions,0),
      'sponsor_served',coalesce(sponsor_daily.served,0),
      'sponsor_viewable_impressions',coalesce(sponsor_daily.viewable_impressions,0),
      'sponsor_clicks',coalesce(sponsor_daily.clicks,0)
    ) ORDER BY days.event_date),'[]'::jsonb)
      FROM days LEFT JOIN topic_daily USING(event_date) LEFT JOIN comment_daily USING(event_date) LEFT JOIN sponsor_daily USING(event_date)),
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topic_entities) ORDER BY impressions DESC),'[]'::jsonb) FROM topic_entities),
    'categories',(SELECT coalesce(jsonb_agg(to_jsonb(category_entities) ORDER BY impressions DESC),'[]'::jsonb) FROM category_entities),
    'sponsors',(SELECT coalesce(jsonb_agg(to_jsonb(sponsor_entities) ORDER BY served DESC),'[]'::jsonb) FROM sponsor_entities),
    'comments',(SELECT coalesce(jsonb_agg(to_jsonb(comment_entities) ORDER BY impressions DESC),'[]'::jsonb) FROM comment_entities)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_admin_anonymous_analytics(uuid,timestamptz,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_anonymous_analytics(uuid,timestamptz,timestamptz,text,text) TO service_role;
DO $anonymous_analytics_cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cathoscroll-anonymous-analytics-prune') THEN
    PERFORM cron.schedule('cathoscroll-anonymous-analytics-prune','*/15 * * * *',
      'SELECT catho_private.prune_anonymous_analytics();');
  END IF;
END;
$anonymous_analytics_cron$;
-- END ANONYMOUS ANALYTICS ROLLOUT


-- ANONYMOUS SPONSOR ANALYTICS REPLACEMENTS

-- ANONYMOUS PIPELINE FUNCTION DEFINITIONS (exact live definitions)
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


CREATE OR REPLACE FUNCTION catho_private.prune_anonymous_analytics()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_deleted integer:=0; v_batch integer:=0;
BEGIN
 WITH expired AS (
   SELECT ctid FROM catho_private.anonymous_sponsor_events
   WHERE received_at < statement_timestamp()-interval '30 days'
   ORDER BY received_at LIMIT 5000 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM catho_private.anonymous_sponsor_events target
 USING expired WHERE target.ctid=expired.ctid;
 GET DIAGNOSTICS v_batch = ROW_COUNT;
 v_deleted:=v_deleted+v_batch;

 WITH expired AS (
   SELECT ctid FROM catho_private.anonymous_sponsor_session_frequency
   WHERE last_served_at < statement_timestamp()-interval '30 days'
   ORDER BY last_served_at LIMIT 5000 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM catho_private.anonymous_sponsor_session_frequency target
 USING expired WHERE target.ctid=expired.ctid;
 GET DIAGNOSTICS v_batch = ROW_COUNT;
 v_deleted:=v_deleted+v_batch;

 WITH expired AS (
   SELECT ctid FROM catho_private.anonymous_feed_event_receipts
   WHERE received_at < statement_timestamp()-interval '30 days'
   ORDER BY received_at LIMIT 5000 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM catho_private.anonymous_feed_event_receipts target
 USING expired WHERE target.ctid=expired.ctid;
 GET DIAGNOSTICS v_batch = ROW_COUNT;
 v_deleted:=v_deleted+v_batch;

 RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_anonymous_feed_analytics(p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_event jsonb; v_count integer := 0; v_date date := (pg_catalog.timezone('UTC',statement_timestamp()))::date;
 v_type text; v_id text; v_kind text; v_duration integer; v_event_id uuid;
BEGIN
 IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) < 1 OR jsonb_array_length(p_events) > 40 THEN
   RAISE EXCEPTION 'Invalid anonymous analytics batch' USING ERRCODE='22023';
 END IF;
 FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
   IF jsonb_typeof(v_event) <> 'object'
      OR (v_event->>'eventId') IS NULL OR (v_event->>'eventId') !~* '^[0-9a-f-]{36}$'
      OR v_event->>'entityType' NOT IN ('topic','comment')
      OR length(coalesce(v_event->>'entityId','')) NOT BETWEEN 1 AND 160
      OR v_event->>'eventType' NOT IN ('impression','viewable_impression','active_duration','skip','completion','open') THEN
     RAISE EXCEPTION 'Invalid anonymous analytics event' USING ERRCODE='22023';
   END IF;
   v_event_id := (v_event->>'eventId')::uuid;
   v_type := v_event->>'entityType'; v_id := v_event->>'entityId'; v_kind := v_event->>'eventType';
   IF v_type='topic' THEN
     PERFORM 1 FROM public.topics t WHERE t.id=v_id AND t.is_published;
     IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or unpublished topic analytics entity' USING ERRCODE='22023'; END IF;
   ELSIF v_type='comment' THEN
     BEGIN
       PERFORM 1 FROM public.comments c JOIN public.topics t ON t.id=c.topic_id WHERE c.id=v_id::bigint AND c.parent_id IS NULL AND c.is_deleted=false AND t.is_published;
     EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
       RAISE EXCEPTION 'Invalid comment analytics entity' USING ERRCODE='22023';
     END;
     IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or unavailable comment analytics entity' USING ERRCODE='22023'; END IF;
   END IF;
   IF v_kind='active_duration' AND jsonb_typeof(v_event->'durationMs') <> 'number' THEN
     RAISE EXCEPTION 'Invalid active duration' USING ERRCODE='22023';
   END IF;
   v_duration := CASE WHEN v_kind='active_duration' THEN least(greatest(coalesce((v_event->>'durationMs')::numeric,0),0),60000)::integer ELSE 0 END;
   INSERT INTO catho_private.anonymous_feed_event_receipts(event_id) VALUES(v_event_id) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN CONTINUE; END IF;
   INSERT INTO catho_private.anonymous_feed_analytics_daily(event_date,entity_type,entity_id,impressions,viewable_impressions,active_duration_ms,skips,completions,opens)
   VALUES(v_date,v_type,v_id,
     CASE WHEN v_kind='impression' THEN 1 ELSE 0 END,
     CASE WHEN v_kind='viewable_impression' THEN 1 ELSE 0 END,
     v_duration,
     CASE WHEN v_kind='skip' THEN 1 ELSE 0 END,
     CASE WHEN v_kind='completion' THEN 1 ELSE 0 END,
     CASE WHEN v_kind='open' THEN 1 ELSE 0 END)
   ON CONFLICT(event_date,entity_type,entity_id) DO UPDATE SET
     impressions=catho_private.anonymous_feed_analytics_daily.impressions+EXCLUDED.impressions,
     viewable_impressions=catho_private.anonymous_feed_analytics_daily.viewable_impressions+EXCLUDED.viewable_impressions,
     active_duration_ms=catho_private.anonymous_feed_analytics_daily.active_duration_ms+EXCLUDED.active_duration_ms,
     skips=catho_private.anonymous_feed_analytics_daily.skips+EXCLUDED.skips,
     completions=catho_private.anonymous_feed_analytics_daily.completions+EXCLUDED.completions,
     opens=catho_private.anonymous_feed_analytics_daily.opens+EXCLUDED.opens,
     refreshed_at=statement_timestamp();
   v_count := v_count+1;
 END LOOP;
 RETURN v_count;
END; $function$;
REVOKE ALL ON FUNCTION public.record_anonymous_feed_analytics(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_anonymous_feed_analytics(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_anonymous_sponsor_campaigns(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_anonymous_sponsor_campaigns(text,text,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.record_anonymous_sponsor_campaign_event(p_session_token text, p_campaign_id uuid, p_placement_id text, p_event_id uuid, p_event_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_hash text; v_served timestamptz; v_today date:=(pg_catalog.timezone('UTC',statement_timestamp()))::date;
BEGIN
 IF p_session_token IS NULL OR p_session_token !~* '^[0-9a-f-]{36}$'
  OR p_campaign_id IS NULL OR p_placement_id IS NULL OR length(p_placement_id) NOT BETWEEN 1 AND 160
  OR p_event_id IS NULL OR p_event_type NOT IN ('viewable_impression','click') THEN
  RAISE EXCEPTION 'Invalid anonymous sponsor event' USING ERRCODE='22023';
 END IF;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session_token,'UTF8')),'hex');
 SELECT received_at INTO v_served FROM catho_private.anonymous_sponsor_events
 WHERE campaign_id=p_campaign_id AND session_hash=v_hash AND placement_id=p_placement_id
  AND event_type='served' AND received_at>=statement_timestamp()-interval '24 hours'
 ORDER BY received_at DESC LIMIT 1;
 IF v_served IS NULL THEN RAISE EXCEPTION 'Sponsor placement was not eligible' USING ERRCODE='42501'; END IF;
 IF p_event_type='click' AND NOT EXISTS(
  SELECT 1 FROM catho_private.anonymous_sponsor_events
  WHERE campaign_id=p_campaign_id AND session_hash=v_hash AND placement_id=p_placement_id
   AND event_type='viewable_impression' AND received_at>=v_served
 ) THEN RAISE EXCEPTION 'Click requires a viewable impression for this placement' USING ERRCODE='42501'; END IF;
 INSERT INTO catho_private.anonymous_sponsor_events(campaign_id,event_id,session_hash,placement_id,event_type)
 VALUES(p_campaign_id,p_event_id,v_hash,p_placement_id,p_event_type) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_event_type='viewable_impression' THEN
  INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,viewable_impressions)
  VALUES(v_today,p_campaign_id,1)
  ON CONFLICT(event_date,campaign_id) DO UPDATE SET
   viewable_impressions=catho_private.anonymous_sponsor_campaign_daily.viewable_impressions+1;
 ELSE
  INSERT INTO catho_private.anonymous_sponsor_campaign_daily(event_date,campaign_id,clicks)
  VALUES(v_today,p_campaign_id,1)
  ON CONFLICT(event_date,campaign_id) DO UPDATE SET
   clicks=catho_private.anonymous_sponsor_campaign_daily.clicks+1;
 END IF;
 RETURN true;
END; $function$;
REVOKE ALL ON FUNCTION public.record_anonymous_sponsor_campaign_event(text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_anonymous_sponsor_campaign_event(text,uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION catho_private.prune_anonymous_analytics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION catho_private.prune_anonymous_analytics() TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid,date,date) TO service_role;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid,uuid,date,date) TO service_role;


-- SECURITY HARDENING FOLLOW-UP (20 November 2026)
-- Keep SECURITY DEFINER RPC resolution deterministic. These functions use fully
-- schema-qualified relations/auth helpers; pg_catalog remains implicitly visible.
ALTER FUNCTION public.offline_catalogue_changes(text,text) SET search_path = '';
ALTER FUNCTION public.offline_catalogue_counts() SET search_path = '';
ALTER FUNCTION public.offline_catalogue_head() SET search_path = '';
ALTER FUNCTION public.offline_activity_changes(uuid,text,integer) SET search_path = '';
ALTER FUNCTION public.offline_activity_head(uuid) SET search_path = '';
ALTER FUNCTION public.offline_activity_snapshot(uuid,text) SET search_path = '';
ALTER FUNCTION public.offline_apply_activity_batch(uuid,jsonb) SET search_path = '';
ALTER FUNCTION public.offline_apply_activity_v2(uuid,uuid,uuid,text,text,text,text,boolean,timestamptz) SET search_path = '';
ALTER FUNCTION public.record_feed_analytics_events(jsonb) SET search_path = '';
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
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists (
    select 1 from catho_private.user_analytics_consents as consent
    where consent.user_id = v_user_id and consent.service_improvement = true
  ) then return 0; end if;
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
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_event_type IS NULL OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catho_private.user_analytics_consents AS consent
    WHERE consent.user_id = p_user_id AND consent.sponsor_measurement = true
  ) THEN RETURN false; END IF;
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
