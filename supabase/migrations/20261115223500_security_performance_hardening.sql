-- Security and performance hardening based on the live CathoScroll schema audit.
-- This migration is additive: it does not alter or delete user data.

-- Fail closed for objects created by the postgres role in the exposed schema.
-- New tables, sequences and RPCs must receive explicit grants in their migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Anonymous clients only need read access to the public catalogue and public
-- discussion surfaces. RLS remains the row-level boundary for these reads.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;

-- Private activity tables should not even be queryable by the anonymous role.
REVOKE SELECT ON TABLE public.bookmarks, public.notes, public.progress
  FROM anon;

-- TRUNCATE bypasses row-level security. It is never an application operation.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Admin content is changed through server routes using the service-role client.
-- The authenticated browser/native clients do not need direct content writes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.categories, public.topics
  FROM authenticated;
DROP POLICY IF EXISTS categories_admin_manage ON public.categories;
DROP POLICY IF EXISTS topics_admin_manage ON public.topics;

-- These operations have no client-side use and no corresponding RLS policy.
REVOKE DELETE ON TABLE public.comments, public.profiles
  FROM anon, authenticated;
REVOKE UPDATE ON TABLE public.bookmarks, public.comment_likes
  FROM authenticated;

-- Profiles are public only through the fields used by public profile pages,
-- comments and account UI. Membership and account timestamps are private.
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, display_name, bio)
  ON TABLE public.profiles TO anon, authenticated;

-- A signed-in user can retrieve only their own membership tier. This replaces
-- direct reads of subscription_tier from the publicly readable profiles table.
CREATE OR REPLACE FUNCTION public.get_own_subscription_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.subscription_tier
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
$function$;

REVOKE ALL ON FUNCTION public.get_own_subscription_tier()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_subscription_tier()
  TO authenticated;

-- Policies that only compare a row to auth.uid() should evaluate the auth
-- function once per statement, and user-owned write policies should not target
-- the unauthenticated public role.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

DO $migration$
DECLARE
  policy_row record;
  statement text;
  using_expression text;
  check_expression text;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') LIKE '%auth.uid()%'
        OR COALESCE(with_check, '') LIKE '%auth.uid()%'
      )
  LOOP
    using_expression := CASE
      WHEN policy_row.qual IS NULL THEN NULL
      ELSE replace(policy_row.qual, 'auth.uid()', '(select auth.uid())')
    END;
    check_expression := CASE
      WHEN policy_row.with_check IS NULL THEN NULL
      ELSE replace(policy_row.with_check, 'auth.uid()', '(select auth.uid())')
    END;

    statement := format(
      'ALTER POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    IF policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'SELECT')
      AND policy_row.roles @> ARRAY['public']::name[] THEN
      statement := statement || ' TO authenticated';
    END IF;

    IF using_expression IS NOT NULL THEN
      statement := statement || format(' USING (%s)', using_expression);
    END IF;
    IF check_expression IS NOT NULL THEN
      statement := statement || format(' WITH CHECK (%s)', check_expression);
    END IF;

    EXECUTE statement;
  END LOOP;
END
$migration$;

-- Trigger functions and the DDL event-trigger function must execute only as
-- triggers. Their SECURITY DEFINER bodies must not be callable over PostgREST.
DO $migration$
DECLARE
  function_row record;
BEGIN
  FOR function_row IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS t
          WHERE t.tgfoid = p.oid
            AND NOT t.tgisinternal
        )
        OR p.proname = 'rls_auto_enable'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated, service_role',
      function_row.schema_name,
      function_row.function_name,
      function_row.arguments
    );
  END LOOP;
END
$migration$;

-- Supporting indexes for keyset bookmarks, profile metrics, comment feeds and
-- the seven foreign keys identified by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS bookmarks_user_cursor_idx
  ON public.bookmarks (user_id, created_at DESC, topic_id DESC);

CREATE INDEX IF NOT EXISTS comments_topic_parent_order_idx
  ON public.comments (topic_id, parent_id, is_pinned DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS comments_user_visible_created_idx
  ON public.comments (user_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS progress_user_completed_at_idx
  ON public.progress (user_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS comment_ban_appeals_ban_id_fk_idx
  ON public.comment_ban_appeals (ban_id);

CREATE INDEX IF NOT EXISTS comment_ban_appeals_reviewed_by_fk_idx
  ON public.comment_ban_appeals (reviewed_by);

CREATE INDEX IF NOT EXISTS comment_reports_comment_id_fk_idx
  ON public.comment_reports (comment_id);

CREATE INDEX IF NOT EXISTS comment_reports_reviewed_by_fk_idx
  ON public.comment_reports (reviewed_by);

CREATE INDEX IF NOT EXISTS user_comment_ban_hidden_comments_comment_id_fk_idx
  ON public.user_comment_ban_hidden_comments (comment_id);

CREATE INDEX IF NOT EXISTS user_comment_bans_banned_by_fk_idx
  ON public.user_comment_bans (banned_by);

CREATE INDEX IF NOT EXISTS user_comment_bans_unbanned_by_fk_idx
  ON public.user_comment_bans (unbanned_by);

-- Small private fixed-window counters provide database-enforced limits for
-- writes that currently bypass the Next.js API and write directly through RLS.
CREATE TABLE IF NOT EXISTS catho_private.user_action_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_window_started_at timestamptz,
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  comment_like_window_started_at timestamptz,
  comment_like_count integer NOT NULL DEFAULT 0 CHECK (comment_like_count >= 0),
  appeal_window_started_at timestamptz,
  appeal_count integer NOT NULL DEFAULT 0 CHECK (appeal_count >= 0)
);

ALTER TABLE catho_private.user_action_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.user_action_limits
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catho_private.enforce_user_action_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor uuid;
  now_at timestamptz := pg_catalog.clock_timestamp();
  current_count integer;
  maximum_count integer;
  action_name text;
BEGIN
  IF TG_TABLE_NAME = 'comment_ban_appeals' THEN
    -- Appeals are inserted only by the authenticated server route using the
    -- service-role client; NEW.user_id is the identity already verified there.
    actor := NEW.user_id;
    action_name := 'appeal';
    maximum_count := 3;
  ELSE
    actor := auth.uid();
    IF actor IS NULL THEN
      -- Service-role maintenance operations do not represent end-user actions.
      RETURN NEW;
    END IF;
    IF NEW.user_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Account does not match' USING ERRCODE = '42501';
    END IF;

    IF TG_TABLE_NAME = 'comments' THEN
      action_name := 'comment';
      maximum_count := 20;
    ELSIF TG_TABLE_NAME = 'comment_likes' THEN
      action_name := 'comment_like';
      maximum_count := 180;
    ELSE
      RAISE EXCEPTION 'Unsupported rate-limited action';
    END IF;
  END IF;

  INSERT INTO catho_private.user_action_limits (user_id)
  VALUES (actor)
  ON CONFLICT (user_id) DO NOTHING;

  -- Concurrent requests from the same user serialize on this row and cannot
  -- race past the threshold.
  PERFORM 1
    FROM catho_private.user_action_limits
    WHERE user_id = actor
    FOR UPDATE;

  IF action_name = 'comment' THEN
    UPDATE catho_private.user_action_limits
    SET
      comment_count = CASE
        WHEN comment_window_started_at IS NULL
          OR comment_window_started_at <= now_at - interval '1 hour' THEN 1
        ELSE LEAST(comment_count + 1, maximum_count + 1)
      END,
      comment_window_started_at = CASE
        WHEN comment_window_started_at IS NULL
          OR comment_window_started_at <= now_at - interval '1 hour' THEN now_at
        ELSE comment_window_started_at
      END
    WHERE user_id = actor
    RETURNING comment_count INTO current_count;
  ELSIF action_name = 'comment_like' THEN
    UPDATE catho_private.user_action_limits
    SET
      comment_like_count = CASE
        WHEN comment_like_window_started_at IS NULL
          OR comment_like_window_started_at <= now_at - interval '1 hour' THEN 1
        ELSE LEAST(comment_like_count + 1, maximum_count + 1)
      END,
      comment_like_window_started_at = CASE
        WHEN comment_like_window_started_at IS NULL
          OR comment_like_window_started_at <= now_at - interval '1 hour' THEN now_at
        ELSE comment_like_window_started_at
      END
    WHERE user_id = actor
    RETURNING comment_like_count INTO current_count;
  ELSE
    UPDATE catho_private.user_action_limits
    SET
      appeal_count = CASE
        WHEN appeal_window_started_at IS NULL
          OR appeal_window_started_at <= now_at - interval '24 hours' THEN 1
        ELSE LEAST(appeal_count + 1, maximum_count + 1)
      END,
      appeal_window_started_at = CASE
        WHEN appeal_window_started_at IS NULL
          OR appeal_window_started_at <= now_at - interval '24 hours' THEN now_at
        ELSE appeal_window_started_at
      END
    WHERE user_id = actor
    RETURNING appeal_count INTO current_count;
  END IF;

  IF current_count > maximum_count THEN
    RAISE EXCEPTION 'Rate limit exceeded for %', action_name
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION catho_private.enforce_user_action_rate_limit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS comments_enforce_user_rate_limit ON public.comments;
CREATE TRIGGER comments_enforce_user_rate_limit
  BEFORE INSERT OR UPDATE OF content ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();

DROP TRIGGER IF EXISTS comment_likes_enforce_user_rate_limit ON public.comment_likes;
CREATE TRIGGER comment_likes_enforce_user_rate_limit
  BEFORE INSERT ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();

DROP TRIGGER IF EXISTS comment_ban_appeals_enforce_user_rate_limit ON public.comment_ban_appeals;
CREATE TRIGGER comment_ban_appeals_enforce_user_rate_limit
  BEFORE INSERT ON public.comment_ban_appeals
  FOR EACH ROW
  EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();


-- Public profile pages previously queried every progress row and all comment
-- likes, and RLS hid progress/bookmarks belonging to other users. Return only
-- public aggregate metrics and the six recent public activity items in one
-- bounded SECURITY DEFINER query. The timezone argument preserves the
-- browser-local calendar-day streak semantics used by the existing UI.
CREATE OR REPLACE FUNCTION public.get_public_profile_metrics(
  p_profile_id uuid,
  p_timezone text DEFAULT 'UTC'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  timezone_name text;
  metrics jsonb;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names
      WHERE name = p_timezone
    ) THEN p_timezone
    ELSE 'UTC'
  END
  INTO timezone_name;

  WITH progress_rows AS (
    SELECT completed_at
    FROM public.progress
    WHERE user_id = p_profile_id
      AND completed_at IS NOT NULL
  ),
  days AS (
    SELECT DISTINCT (completed_at AT TIME ZONE timezone_name)::date AS day
    FROM progress_rows
  ),
  ranked_days AS (
    SELECT
      day,
      row_number() OVER (ORDER BY day) AS sequence_number
    FROM days
  ),
  longest_streak AS (
    SELECT COALESCE(MAX(streak_length), 0)::integer AS value
    FROM (
      SELECT count(*) AS streak_length
      FROM ranked_days
      GROUP BY day - sequence_number::integer
    ) AS streak_groups
  ),
  streak_anchor AS (
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM days
        WHERE day = (pg_catalog.now() AT TIME ZONE timezone_name)::date
      ) THEN (pg_catalog.now() AT TIME ZONE timezone_name)::date
      WHEN EXISTS (
        SELECT 1 FROM days
        WHERE day = (pg_catalog.now() AT TIME ZONE timezone_name)::date - 1
      ) THEN (pg_catalog.now() AT TIME ZONE timezone_name)::date - 1
      ELSE NULL
    END AS day
  ),
  current_streak AS (
    SELECT COALESCE(
      count(*) FILTER (
        WHERE day = anchor_day - (sequence_number - 1)::integer
      ),
      0
    )::integer AS value
    FROM (
      SELECT
        days.day,
        streak_anchor.day AS anchor_day,
        row_number() OVER (ORDER BY days.day DESC) AS sequence_number
      FROM days
      CROSS JOIN streak_anchor
      WHERE streak_anchor.day IS NOT NULL
        AND days.day <= streak_anchor.day
    ) AS streak_days
  ),
  recent_progress AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'topic_id', recent.topic_id,
          'completed_at', recent.completed_at
        )
        ORDER BY recent.completed_at DESC
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT progress.topic_id, progress.completed_at
      FROM public.progress AS progress
      JOIN public.topics AS topic
        ON topic.id = progress.topic_id
       AND topic.is_published = true
      JOIN public.categories AS category
        ON category.slug = topic.category_slug
       AND category.is_published = true
      WHERE progress.user_id = p_profile_id
        AND progress.completed_at IS NOT NULL
      ORDER BY progress.completed_at DESC
      LIMIT 6
    ) AS recent
  ),
  recent_comments AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'topic_id', recent.topic_id,
          'content', recent.content,
          'created_at', recent.created_at
        )
        ORDER BY recent.created_at DESC
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT comment.id, comment.topic_id, comment.content, comment.created_at
      FROM public.comments AS comment
      JOIN public.topics AS topic
        ON topic.id = comment.topic_id
       AND topic.is_published = true
      JOIN public.categories AS category
        ON category.slug = topic.category_slug
       AND category.is_published = true
      WHERE comment.user_id = p_profile_id
        AND comment.is_deleted = false
      ORDER BY comment.created_at DESC
      LIMIT 6
    ) AS recent
  )
  SELECT jsonb_build_object(
    'completed_count', (SELECT count(*) FROM progress_rows),
    'bookmark_count', (
      SELECT count(*)
      FROM public.bookmarks
      WHERE user_id = p_profile_id
    ),
    'comment_count', (
      SELECT count(*)
      FROM public.comments
      WHERE user_id = p_profile_id
        AND is_deleted = false
    ),
    'likes_received', (
      SELECT count(*)
      FROM public.comment_likes AS comment_like
      JOIN public.comments AS comment ON comment.id = comment_like.comment_id
      WHERE comment.user_id = p_profile_id
        AND comment.is_deleted = false
    ),
    'current_streak', (SELECT value FROM current_streak),
    'longest_streak', (SELECT value FROM longest_streak),
    'recent_progress', (SELECT value FROM recent_progress),
    'recent_comments', (SELECT value FROM recent_comments)
  )
  INTO metrics;

  RETURN metrics;
END
$function$;

REVOKE ALL ON FUNCTION public.get_public_profile_metrics(uuid, text)
  FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_profile_metrics(uuid, text)
  TO anon, authenticated;


-- Deleted or moderation-hidden comments are rendered as tombstones in the UI.
-- Do not let clients retrieve their original text directly from the base table.
-- The owner-rights view exposes an empty string for deleted content while
-- retaining the identifiers needed to keep reply trees intact.
CREATE OR REPLACE VIEW public.comment_feed AS
SELECT
  comment.id,
  comment.topic_id,
  comment.user_id,
  comment.parent_id,
  CASE WHEN comment.is_deleted THEN ''::text ELSE comment.content END AS content,
  comment.created_at,
  comment.edited_at,
  comment.is_deleted,
  comment.is_pinned
FROM public.comments AS comment;

REVOKE SELECT ON TABLE public.comments FROM anon, authenticated;
REVOKE SELECT (content) ON TABLE public.comments FROM anon, authenticated;
GRANT SELECT (
  id,
  topic_id,
  user_id,
  parent_id,
  created_at,
  edited_at,
  is_deleted,
  is_pinned
) ON TABLE public.comments TO anon, authenticated;
GRANT SELECT ON TABLE public.comment_feed TO anon, authenticated;
