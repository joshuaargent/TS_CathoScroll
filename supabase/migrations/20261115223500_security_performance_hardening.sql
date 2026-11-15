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
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

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
  window_started_at timestamptz;
  action_name text;
BEGIN
  IF TG_TABLE_NAME = 'comment_ban_appeals' THEN
    actor := NEW.user_id;
    action_name := 'appeal';
    maximum_count := 3;
    SELECT appeal_window_started_at, appeal_count
      INTO window_started_at, current_count
      FROM catho_private.user_action_limits
      WHERE user_id = actor
      FOR UPDATE;
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
      SELECT comment_window_started_at, comment_count
        INTO window_started_at, current_count
        FROM catho_private.user_action_limits
        WHERE user_id = actor
        FOR UPDATE;
    ELSIF TG_TABLE_NAME = 'comment_likes' THEN
      action_name := 'comment_like';
      maximum_count := 180;
      SELECT comment_like_window_started_at, comment_like_count
        INTO window_started_at, current_count
        FROM catho_private.user_action_limits
        WHERE user_id = actor
        FOR UPDATE;
    ELSE
      RAISE EXCEPTION 'Unsupported rate-limited action';
    END IF;
  END IF;

  INSERT INTO catho_private.user_action_limits (user_id)
  VALUES (actor)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock after ensuring that the counter row exists. Concurrent requests from
  -- the same user serialize on this row and cannot race past the threshold.
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
  BEFORE INSERT ON public.comments
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
