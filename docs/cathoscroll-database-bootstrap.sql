-- CathoScroll complete application-schema bootstrap
-- Generated from production schema on 2026-11-16.
--
-- IMPORTANT:
--   * Run ONLY against a fresh Supabase project. This script intentionally
--     stops if CathoScroll application tables already exist.
--   * This recreates CathoScroll application objects, not Supabase-managed
--     auth, storage, realtime, vault, API gateway, or platform internals.
--   * It does NOT restore rows, Auth users/passwords, Storage objects, secrets,
--     project settings, Edge Functions, or external environment variables.
--     Back those up separately.
--   * The target must have standard Supabase roles and auth.users, and should
--     use the same PostgreSQL major version as the source project.
--   * pg_cron and permission to create the ensure_rls event trigger are required.
--
-- Object counts at export: 27 tables, 61 functions, 33 triggers, 32 policies.
--
DO $bootstrap_guard$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'CathoScroll bootstrap requires a Supabase project with auth.users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'CathoScroll bootstrap requires Supabase anon, authenticated and service_role roles';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'catho_private') AND c.relkind IN ('r', 'p')
      AND c.relname <> 'schema_migrations'
  ) THEN
    RAISE EXCEPTION 'CathoScroll application tables already exist. This is a clean-project bootstrap, not an upgrade script.';
  END IF;
END;
$bootstrap_guard$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE SCHEMA IF NOT EXISTS catho_private;

CREATE TABLE catho_private.activity_devices (
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  acknowledged_sequence bigint DEFAULT 0 NOT NULL,
  last_sequence bigint DEFAULT 0 NOT NULL,
  CONSTRAINT activity_devices_check CHECK (acknowledged_sequence >= 0 AND acknowledged_sequence <= last_sequence),
  CONSTRAINT activity_devices_pkey PRIMARY KEY (user_id, device_id)
);
CREATE TABLE catho_private.activity_events (
  user_id uuid NOT NULL,
  revision bigint NOT NULL,
  kind text NOT NULL,
  topic_id text NOT NULL,
  value boolean NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT activity_events_kind_check CHECK (kind = ANY (ARRAY['bookmark'::text, 'like'::text, 'progress'::text])),
  CONSTRAINT activity_events_pkey PRIMARY KEY (user_id, revision)
);
CREATE TABLE catho_private.activity_heads (
  user_id uuid NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  floor_revision bigint DEFAULT 0 NOT NULL,
  CONSTRAINT activity_heads_check CHECK (floor_revision >= 0 AND floor_revision <= revision),
  CONSTRAINT activity_heads_pkey PRIMARY KEY (user_id),
  CONSTRAINT activity_heads_revision_check CHECK (revision >= 0)
);
CREATE TABLE catho_private.activity_receipt_sequences (
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  sequence bigint NOT NULL,
  operation_id uuid NOT NULL,
  CONSTRAINT activity_receipt_sequences_pkey PRIMARY KEY (user_id, device_id, sequence),
  CONSTRAINT activity_receipt_sequences_sequence_check CHECK (sequence > 0),
  CONSTRAINT activity_receipt_sequences_user_id_operation_id_key UNIQUE (user_id, operation_id)
);
CREATE TABLE catho_private.activity_receipts (
  user_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  topic_id text NOT NULL,
  value boolean NOT NULL,
  requested_completed_at timestamp with time zone,
  completed_at timestamp with time zone,
  revision bigint,
  status text,
  rejection_reason text,
  CONSTRAINT activity_receipts_pkey PRIMARY KEY (user_id, operation_id),
  CONSTRAINT activity_receipts_rejection_reason_check CHECK (rejection_reason = 'topic_unavailable'::text),
  CONSTRAINT activity_receipts_status_check CHECK (status = ANY (ARRAY['applied'::text, 'rejected'::text]))
);
CREATE TABLE catho_private.admin_action_audit (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  target_user_id uuid,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT admin_action_audit_action_check CHECK (char_length(action) >= 1 AND char_length(action) <= 100),
  CONSTRAINT admin_action_audit_pkey PRIMARY KEY (id),
  CONSTRAINT admin_action_audit_target_id_check CHECK (char_length(target_id) >= 1 AND char_length(target_id) <= 200),
  CONSTRAINT admin_action_audit_target_type_check CHECK (char_length(target_type) >= 1 AND char_length(target_type) <= 100)
);
CREATE TABLE catho_private.admin_owners (
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT admin_owners_pkey PRIMARY KEY (user_id)
);
CREATE TABLE catho_private.api_rate_limits (
  key_hash text NOT NULL,
  window_started_at timestamp with time zone NOT NULL,
  request_count integer NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT api_rate_limits_key_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$'::text),
  CONSTRAINT api_rate_limits_pkey PRIMARY KEY (key_hash),
  CONSTRAINT api_rate_limits_request_count_check CHECK (request_count >= 1)
);
CREATE TABLE catho_private.security_controls (
  singleton boolean DEFAULT true NOT NULL,
  admin_mfa_enforced boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT security_controls_pkey PRIMARY KEY (singleton),
  CONSTRAINT security_controls_singleton_check CHECK (singleton)
);
CREATE TABLE catho_private.user_action_limits (
  user_id uuid NOT NULL,
  comment_window_started_at timestamp with time zone,
  comment_count integer DEFAULT 0 NOT NULL,
  comment_like_window_started_at timestamp with time zone,
  comment_like_count integer DEFAULT 0 NOT NULL,
  appeal_window_started_at timestamp with time zone,
  appeal_count integer DEFAULT 0 NOT NULL,
  topic_like_window_started_at timestamp with time zone,
  topic_like_count integer DEFAULT 0 NOT NULL,
  recommendation_window_started_at timestamp with time zone,
  recommendation_count integer DEFAULT 0 NOT NULL,
  bookmark_window_started_at timestamp with time zone,
  bookmark_count integer DEFAULT 0 NOT NULL,
  progress_window_started_at timestamp with time zone,
  progress_count integer DEFAULT 0 NOT NULL,
  comment_burst_window_started_at timestamp with time zone,
  comment_burst_count integer DEFAULT 0 NOT NULL,
  comment_day_window_started_at timestamp with time zone,
  comment_day_count integer DEFAULT 0 NOT NULL,
  offline_sync_window_started_at timestamp with time zone,
  offline_sync_count integer DEFAULT 0 NOT NULL,
  CONSTRAINT user_action_limits_appeal_count_check CHECK (appeal_count >= 0),
  CONSTRAINT user_action_limits_comment_count_check CHECK (comment_count >= 0),
  CONSTRAINT user_action_limits_comment_like_count_check CHECK (comment_like_count >= 0),
  CONSTRAINT user_action_limits_offline_sync_count_check CHECK (offline_sync_count >= 0),
  CONSTRAINT user_action_limits_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_action_limits_recommendation_count_check CHECK (recommendation_count >= 0),
  CONSTRAINT user_action_limits_topic_like_count_check CHECK (topic_like_count >= 0)
);
CREATE TABLE public.admin_users (
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT admin_users_pkey PRIMARY KEY (user_id)
);
CREATE TABLE public.bookmarks (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  topic_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT bookmarks_pkey PRIMARY KEY (id),
  CONSTRAINT bookmarks_user_id_topic_id_key UNIQUE (user_id, topic_id)
);
CREATE TABLE public.categories (
  slug text NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  order_index integer DEFAULT 0 NOT NULL,
  is_published boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT categories_name_key UNIQUE (name),
  CONSTRAINT categories_pkey PRIMARY KEY (slug)
);
CREATE TABLE public.comment_ban_appeals (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  ban_id bigint NOT NULL,
  message text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comment_ban_appeals_admin_note_check CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  CONSTRAINT comment_ban_appeals_message_check CHECK (char_length(message) >= 20 AND char_length(message) <= 2000),
  CONSTRAINT comment_ban_appeals_pkey PRIMARY KEY (id),
  CONSTRAINT comment_ban_appeals_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text]))
);
CREATE TABLE public.comment_likes (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  comment_id bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comment_likes_pkey PRIMARY KEY (id),
  CONSTRAINT comment_likes_user_id_comment_id_key UNIQUE (user_id, comment_id)
);
CREATE TABLE public.comment_reports (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  reporter_id uuid NOT NULL,
  comment_id bigint NOT NULL,
  reason text NOT NULL,
  details text,
  status text DEFAULT 'pending'::text NOT NULL,
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comment_reports_admin_note_check CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  CONSTRAINT comment_reports_details_check CHECK (details IS NULL OR char_length(details) <= 1000),
  CONSTRAINT comment_reports_pkey PRIMARY KEY (id),
  CONSTRAINT comment_reports_reason_check CHECK (reason = ANY (ARRAY['harassment'::text, 'hate_speech'::text, 'spam'::text, 'inappropriate'::text, 'other'::text])),
  CONSTRAINT comment_reports_status_check CHECK (status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text]))
);
CREATE TABLE public.comments (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  topic_id text NOT NULL,
  parent_id bigint,
  content text NOT NULL,
  edited_at timestamp with time zone,
  is_deleted boolean DEFAULT false NOT NULL,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT comments_content_check CHECK (char_length(content) >= 1 AND char_length(content) <= 2000),
  CONSTRAINT comments_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notes (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  topic_id text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_user_id_topic_id_key UNIQUE (user_id, topic_id)
);
CREATE TABLE public.notifications (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  topic_id text,
  comment_id bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone,
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
CREATE TABLE public.offline_catalogue_events (
  revision bigint NOT NULL,
  kind text NOT NULL,
  entity_key text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT offline_catalogue_events_kind_check CHECK (kind = ANY (ARRAY['category'::text, 'topic'::text, 'reset'::text])),
  CONSTRAINT offline_catalogue_events_pkey PRIMARY KEY (revision)
);
CREATE TABLE public.offline_catalogue_revision (
  singleton boolean DEFAULT true NOT NULL,
  revision bigint NOT NULL,
  floor_revision bigint DEFAULT 0 NOT NULL,
  CONSTRAINT offline_catalogue_revision_check CHECK (floor_revision >= 0 AND floor_revision <= revision),
  CONSTRAINT offline_catalogue_revision_pkey PRIMARY KEY (singleton),
  CONSTRAINT offline_catalogue_revision_revision_check CHECK (revision >= 0),
  CONSTRAINT offline_catalogue_revision_singleton_check CHECK (singleton)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  bio text,
  subscription_tier text DEFAULT 'free'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_username_key UNIQUE (username)
);
CREATE TABLE public.progress (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  topic_id text NOT NULL,
  completed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT progress_pkey PRIMARY KEY (id),
  CONSTRAINT progress_user_id_topic_id_key UNIQUE (user_id, topic_id)
);
CREATE TABLE public.topic_likes (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  topic_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT topic_likes_pkey PRIMARY KEY (id),
  CONSTRAINT topic_likes_user_id_topic_id_key UNIQUE (user_id, topic_id)
);
CREATE TABLE public.topics (
  id text NOT NULL,
  slug text NOT NULL,
  category_slug text NOT NULL,
  order_index integer DEFAULT 0 NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  explanation text DEFAULT ''::text NOT NULL,
  catechism_paragraphs text[] DEFAULT '{}'::text[] NOT NULL,
  catechism_text text DEFAULT ''::text NOT NULL,
  scripture_reference text DEFAULT ''::text NOT NULL,
  scripture_text text DEFAULT ''::text NOT NULL,
  is_published boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (((((((setweight(to_tsvector('english'::regconfig, COALESCE(question, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(slug, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(answer, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(explanation, ''::text)), 'C'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(catechism_text, ''::text)), 'C'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(scripture_reference, ''::text)), 'D'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(scripture_text, ''::text)), 'D'::"char"))) STORED,
  CONSTRAINT topics_pkey PRIMARY KEY (id),
  CONSTRAINT topics_slug_key UNIQUE (slug)
);
CREATE TABLE public.user_comment_ban_hidden_comments (
  ban_id bigint NOT NULL,
  comment_id bigint NOT NULL,
  was_deleted boolean DEFAULT false NOT NULL,
  CONSTRAINT user_comment_ban_hidden_comments_pkey PRIMARY KEY (ban_id, comment_id)
);
CREATE TABLE public.user_comment_bans (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  banned_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  unbanned_at timestamp with time zone,
  unbanned_by uuid,
  unban_reason text,
  CONSTRAINT user_comment_bans_check CHECK (unbanned_at IS NULL AND unbanned_by IS NULL OR unbanned_at IS NOT NULL AND unbanned_by IS NOT NULL),
  CONSTRAINT user_comment_bans_pkey PRIMARY KEY (id),
  CONSTRAINT user_comment_bans_reason_check CHECK (char_length(reason) >= 5 AND char_length(reason) <= 1000)
);

-- Foreign keys (created after all referenced tables)
ALTER TABLE catho_private.activity_devices ADD CONSTRAINT activity_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE catho_private.activity_events ADD CONSTRAINT activity_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE catho_private.activity_heads ADD CONSTRAINT activity_heads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE catho_private.activity_receipt_sequences ADD CONSTRAINT activity_receipt_sequences_user_id_device_id_fkey FOREIGN KEY (user_id, device_id) REFERENCES catho_private.activity_devices(user_id, device_id) ON DELETE CASCADE;
ALTER TABLE catho_private.activity_receipt_sequences ADD CONSTRAINT activity_receipt_sequences_user_id_operation_id_fkey FOREIGN KEY (user_id, operation_id) REFERENCES catho_private.activity_receipts(user_id, operation_id) ON DELETE CASCADE;
ALTER TABLE catho_private.activity_receipts ADD CONSTRAINT activity_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE catho_private.admin_owners ADD CONSTRAINT admin_owners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE catho_private.user_action_limits ADD CONSTRAINT user_action_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.bookmarks ADD CONSTRAINT bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.comment_ban_appeals ADD CONSTRAINT comment_ban_appeals_ban_id_fkey FOREIGN KEY (ban_id) REFERENCES user_comment_bans(id) ON DELETE CASCADE;
ALTER TABLE public.comment_ban_appeals ADD CONSTRAINT comment_ban_appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.comment_ban_appeals ADD CONSTRAINT comment_ban_appeals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.comment_reports ADD CONSTRAINT comment_reports_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE public.comment_reports ADD CONSTRAINT comment_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.comment_reports ADD CONSTRAINT comment_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.comments ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE public.comments ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notes ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.progress ADD CONSTRAINT progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.topic_likes ADD CONSTRAINT topic_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.topics ADD CONSTRAINT topics_category_slug_fkey FOREIGN KEY (category_slug) REFERENCES categories(slug) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.user_comment_ban_hidden_comments ADD CONSTRAINT user_comment_ban_hidden_comments_ban_id_fkey FOREIGN KEY (ban_id) REFERENCES user_comment_bans(id) ON DELETE CASCADE;
ALTER TABLE public.user_comment_ban_hidden_comments ADD CONSTRAINT user_comment_ban_hidden_comments_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE public.user_comment_bans ADD CONSTRAINT user_comment_bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.user_comment_bans ADD CONSTRAINT user_comment_bans_unbanned_by_fkey FOREIGN KEY (unbanned_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.user_comment_bans ADD CONSTRAINT user_comment_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes not created by primary/unique constraints
CREATE INDEX catho_activity_events_retention_idx ON catho_private.activity_events USING btree (created_at, user_id, revision);
CREATE INDEX api_rate_limits_updated_at_idx ON catho_private.api_rate_limits USING btree (updated_at);
CREATE INDEX bookmarks_created_at_idx ON public.bookmarks USING btree (created_at);
CREATE INDEX bookmarks_user_cursor_idx ON public.bookmarks USING btree (user_id, created_at DESC, topic_id DESC);
CREATE INDEX bookmarks_user_id_idx ON public.bookmarks USING btree (user_id);
CREATE INDEX comment_ban_appeals_ban_id_fk_idx ON public.comment_ban_appeals USING btree (ban_id);
CREATE UNIQUE INDEX comment_ban_appeals_one_pending_per_user ON public.comment_ban_appeals USING btree (user_id) WHERE (status = 'pending'::text);
CREATE INDEX comment_ban_appeals_reviewed_by_fk_idx ON public.comment_ban_appeals USING btree (reviewed_by);
CREATE INDEX comment_ban_appeals_status_created ON public.comment_ban_appeals USING btree (status, created_at DESC);
CREATE INDEX comment_likes_comment_id_idx ON public.comment_likes USING btree (comment_id);
CREATE INDEX comment_likes_user_id_idx ON public.comment_likes USING btree (user_id);
CREATE INDEX comment_reports_comment_id_fk_idx ON public.comment_reports USING btree (comment_id);
CREATE UNIQUE INDEX comment_reports_one_open_per_comment ON public.comment_reports USING btree (reporter_id, comment_id) WHERE (status = ANY (ARRAY['pending'::text, 'reviewing'::text]));
CREATE INDEX comment_reports_reporter_created ON public.comment_reports USING btree (reporter_id, created_at DESC);
CREATE INDEX comment_reports_reviewed_by_fk_idx ON public.comment_reports USING btree (reviewed_by);
CREATE INDEX comment_reports_status_created ON public.comment_reports USING btree (status, created_at DESC);
CREATE INDEX comments_created_at_idx ON public.comments USING btree (created_at);
CREATE INDEX comments_parent_id_idx ON public.comments USING btree (parent_id);
CREATE INDEX comments_pinned_idx ON public.comments USING btree (is_pinned);
CREATE INDEX comments_recommendation_user_topic_idx ON public.comments USING btree (user_id, topic_id) WHERE (is_deleted = false);
CREATE INDEX comments_topic_created_idx ON public.comments USING btree (topic_id, created_at DESC, id DESC);
CREATE INDEX comments_topic_id_idx ON public.comments USING btree (topic_id);
CREATE INDEX comments_topic_parent_order_idx ON public.comments USING btree (topic_id, parent_id, is_pinned DESC, created_at DESC, id DESC);
CREATE INDEX comments_user_id_idx ON public.comments USING btree (user_id);
CREATE INDEX comments_user_visible_created_idx ON public.comments USING btree (user_id, created_at DESC) WHERE (is_deleted = false);
CREATE INDEX notes_topic_id_idx ON public.notes USING btree (topic_id);
CREATE INDEX notes_user_id_idx ON public.notes USING btree (user_id);
CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);
CREATE INDEX progress_completed_at_idx ON public.progress USING btree (completed_at);
CREATE INDEX progress_topic_id_idx ON public.progress USING btree (topic_id);
CREATE INDEX progress_user_completed_at_idx ON public.progress USING btree (user_id, completed_at DESC);
CREATE INDEX progress_user_id_idx ON public.progress USING btree (user_id);
CREATE INDEX topic_likes_topic_id_idx ON public.topic_likes USING btree (topic_id);
CREATE INDEX topic_likes_user_id_idx ON public.topic_likes USING btree (user_id);
CREATE INDEX topics_category_order_idx ON public.topics USING btree (category_slug, order_index) WHERE (is_published = true);
CREATE INDEX topics_published_order_idx ON public.topics USING btree (order_index) WHERE (is_published = true);
CREATE INDEX topics_recent_created_idx ON public.topics USING btree (created_at DESC NULLS LAST, id DESC) WHERE (is_published = true);
CREATE INDEX topics_recommendation_cursor_idx ON public.topics USING btree (category_slug, order_index, id) WHERE (is_published = true);
CREATE INDEX topics_search_vector_idx ON public.topics USING gin (search_vector);
CREATE INDEX user_comment_ban_hidden_comments_comment_id_fk_idx ON public.user_comment_ban_hidden_comments USING btree (comment_id);
CREATE INDEX user_comment_bans_banned_by_fk_idx ON public.user_comment_bans USING btree (banned_by);
CREATE UNIQUE INDEX user_comment_bans_one_active_per_user ON public.user_comment_bans USING btree (user_id) WHERE (unbanned_at IS NULL);
CREATE INDEX user_comment_bans_unbanned_by_fk_idx ON public.user_comment_bans USING btree (unbanned_by);

-- Restore functions before triggers. Function-body checking is disabled
-- during creation to avoid ordering dependencies between function bodies.
SET check_function_bodies = off;
-- Application functions
CREATE OR REPLACE FUNCTION catho_private.activity_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'catho_private'
AS $function$
declare activity_kind text;
begin
  activity_kind := case tg_table_name
    when 'bookmarks' then 'bookmark'
    when 'topic_likes' then 'like'
    when 'progress' then 'progress'
    else null
  end;
  if activity_kind is null then raise exception 'Unexpected activity table'; end if;
  if tg_op in ('DELETE', 'UPDATE') and
    (tg_op = 'DELETE' or old.user_id is distinct from new.user_id or old.topic_id is distinct from new.topic_id)
  then
    if exists (select 1 from auth.users where id = old.user_id) then
      perform catho_private.record_activity(old.user_id, activity_kind, old.topic_id, false, null);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and
    (tg_op = 'INSERT' or old.user_id is distinct from new.user_id or old.topic_id is distinct from new.topic_id
      or (activity_kind = 'progress' and (to_jsonb(old)->>'completed_at') is distinct from (to_jsonb(new)->>'completed_at')))
  then
    perform catho_private.record_activity(new.user_id, activity_kind, new.topic_id, true,
      case when activity_kind = 'progress' then (to_jsonb(new)->>'completed_at')::timestamptz else null end);
  end if;
  return null;
end;
$function$

CREATE OR REPLACE FUNCTION catho_private.audit_moderation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid; action_name text; target_user uuid; target_identifier text; event_details jsonb:='{}'::jsonb;
BEGIN
IF TG_TABLE_NAME='user_comment_bans' THEN
 target_user:=NEW.user_id; target_identifier:=NEW.id::text;
 IF TG_OP='INSERT' THEN actor:=NEW.banned_by; action_name:='comment_ban.created'; event_details:=jsonb_build_object('reason',NEW.reason);
 ELSIF OLD.unbanned_at IS NULL AND NEW.unbanned_at IS NOT NULL THEN actor:=NEW.unbanned_by; action_name:='comment_ban.revoked'; event_details:=jsonb_build_object('reason',NEW.unban_reason);
 ELSE RETURN NEW; END IF;
ELSIF TG_TABLE_NAME='comment_ban_appeals' THEN
 IF TG_OP<>'UPDATE' OR OLD.status=NEW.status OR NEW.reviewed_by IS NULL THEN RETURN NEW; END IF;
 actor:=NEW.reviewed_by; target_user:=NEW.user_id; target_identifier:=NEW.id::text; action_name:='comment_ban_appeal.reviewed'; event_details:=jsonb_build_object('status',NEW.status,'note',NEW.admin_note);
ELSIF TG_TABLE_NAME='comment_reports' THEN
 IF TG_OP<>'UPDATE' OR OLD.status=NEW.status OR NEW.reviewed_by IS NULL THEN RETURN NEW; END IF;
 actor:=NEW.reviewed_by; target_identifier:=NEW.id::text; action_name:='comment_report.reviewed'; event_details:=jsonb_build_object('status',NEW.status,'note',NEW.admin_note);
ELSE RETURN NEW; END IF;
IF actor IS NULL THEN RAISE EXCEPTION 'Administrator identity is required for moderation changes' USING ERRCODE='42501'; END IF;
INSERT INTO catho_private.admin_action_audit(actor_user_id,action,target_type,target_id,target_user_id,details) VALUES(actor,action_name,TG_TABLE_NAME,target_identifier,target_user,event_details);
RETURN NEW;
END;$function$

CREATE OR REPLACE FUNCTION catho_private.consume_recommendation_rate_limit(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  now_at timestamptz:=pg_catalog.clock_timestamp();
  request_count integer;
  caller_id uuid:=auth.uid();
BEGIN
  IF p_user_id IS NULL OR caller_id IS NULL OR caller_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Can only consume your own recommendation rate limit' USING ERRCODE='42501';
  END IF;
  INSERT INTO catho_private.user_action_limits(user_id)
  VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM catho_private.user_action_limits WHERE user_id=p_user_id FOR UPDATE;
  UPDATE catho_private.user_action_limits
  SET
    recommendation_count=CASE
      WHEN recommendation_window_started_at IS NULL
        OR recommendation_window_started_at<=now_at-interval '1 minute' THEN 1
      ELSE LEAST(recommendation_count+1,31)
    END,
    recommendation_window_started_at=CASE
      WHEN recommendation_window_started_at IS NULL
        OR recommendation_window_started_at<=now_at-interval '1 minute' THEN now_at
      ELSE recommendation_window_started_at
    END
  WHERE user_id=p_user_id RETURNING recommendation_count INTO request_count;
  RETURN request_count<=30;
END;
$function$

CREATE OR REPLACE FUNCTION catho_private.enforce_activity_mutation_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  row_user_id uuid;
  now_at timestamptz := pg_catalog.clock_timestamp();
  maximum_count integer;
  current_count integer;
BEGIN
  row_user_id := CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF actor IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF row_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Account does not match' USING ERRCODE='42501';
  END IF;

  IF TG_TABLE_NAME='bookmarks' THEN
    maximum_count:=120;
  ELSIF TG_TABLE_NAME='progress' THEN
    maximum_count:=1000;
  ELSE
    RAISE EXCEPTION 'Unsupported activity mutation table';
  END IF;

  INSERT INTO catho_private.user_action_limits(user_id)
  VALUES(actor) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM catho_private.user_action_limits WHERE user_id=actor FOR UPDATE;

  IF TG_TABLE_NAME='bookmarks' THEN
    UPDATE catho_private.user_action_limits
    SET bookmark_count=CASE
      WHEN bookmark_window_started_at IS NULL OR bookmark_window_started_at<=now_at-interval '1 hour' THEN 1
      ELSE LEAST(bookmark_count+1,maximum_count+1)
    END,
    bookmark_window_started_at=CASE
      WHEN bookmark_window_started_at IS NULL OR bookmark_window_started_at<=now_at-interval '1 hour' THEN now_at
      ELSE bookmark_window_started_at
    END
    WHERE user_id=actor RETURNING bookmark_count INTO current_count;
  ELSE
    UPDATE catho_private.user_action_limits
    SET progress_count=CASE
      WHEN progress_window_started_at IS NULL OR progress_window_started_at<=now_at-interval '1 hour' THEN 1
      ELSE LEAST(progress_count+1,maximum_count+1)
    END,
    progress_window_started_at=CASE
      WHEN progress_window_started_at IS NULL OR progress_window_started_at<=now_at-interval '1 hour' THEN now_at
      ELSE progress_window_started_at
    END
    WHERE user_id=actor RETURNING progress_count INTO current_count;
  END IF;

  IF current_count>maximum_count THEN
    RAISE EXCEPTION 'Rate limit exceeded for %',TG_TABLE_NAME USING ERRCODE='P0001';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$

CREATE OR REPLACE FUNCTION catho_private.enforce_user_action_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  current_count integer;
  burst_count integer;
  day_count integer;
  maximum_count integer;
  action_name text;
BEGIN
  IF TG_TABLE_NAME='comment_ban_appeals' THEN
    actor:=NEW.user_id;
    action_name:='appeal';
    maximum_count:=3;
  ELSE
    actor:=auth.uid();
    IF actor IS NULL THEN RETURN NEW; END IF;
    IF NEW.user_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Account does not match' USING ERRCODE='42501';
    END IF;
    IF TG_TABLE_NAME='comments' THEN
      action_name:='comment';
      maximum_count:=40;
    ELSIF TG_TABLE_NAME='comment_likes' THEN
      action_name:='comment_like';
      maximum_count:=180;
    ELSIF TG_TABLE_NAME='topic_likes' THEN
      action_name:='topic_like';
      maximum_count:=180;
    ELSE
      RAISE EXCEPTION 'Unsupported rate-limited action';
    END IF;
  END IF;

  INSERT INTO catho_private.user_action_limits(user_id)
  VALUES(actor) ON CONFLICT(user_id) DO NOTHING;
  PERFORM 1 FROM catho_private.user_action_limits WHERE user_id=actor FOR UPDATE;

  IF action_name='comment' THEN
    UPDATE catho_private.user_action_limits
    SET
      comment_burst_count=CASE
        WHEN comment_burst_window_started_at IS NULL
          OR comment_burst_window_started_at<=now_at-interval '10 minutes' THEN 1
        ELSE LEAST(comment_burst_count+1,11)
      END,
      comment_burst_window_started_at=CASE
        WHEN comment_burst_window_started_at IS NULL
          OR comment_burst_window_started_at<=now_at-interval '10 minutes' THEN now_at
        ELSE comment_burst_window_started_at
      END
    WHERE user_id=actor RETURNING comment_burst_count INTO burst_count;
    IF burst_count>10 THEN
      RAISE EXCEPTION 'Comment burst limit exceeded' USING ERRCODE='P0001';
    END IF;

    UPDATE catho_private.user_action_limits
    SET
      comment_count=CASE
        WHEN comment_window_started_at IS NULL OR comment_window_started_at<=now_at-interval '1 hour' THEN 1
        ELSE LEAST(comment_count+1,maximum_count+1)
      END,
      comment_window_started_at=CASE
        WHEN comment_window_started_at IS NULL OR comment_window_started_at<=now_at-interval '1 hour' THEN now_at
        ELSE comment_window_started_at
      END,
      comment_day_count=CASE
        WHEN comment_day_window_started_at IS NULL OR comment_day_window_started_at<=now_at-interval '24 hours' THEN 1
        ELSE LEAST(comment_day_count+1,121)
      END,
      comment_day_window_started_at=CASE
        WHEN comment_day_window_started_at IS NULL OR comment_day_window_started_at<=now_at-interval '24 hours' THEN now_at
        ELSE comment_day_window_started_at
      END
    WHERE user_id=actor
    RETURNING comment_count,comment_day_count INTO current_count,day_count;
    IF current_count>maximum_count OR day_count>120 THEN
      RAISE EXCEPTION 'Comment rate limit exceeded' USING ERRCODE='P0001';
    END IF;

  ELSIF action_name='comment_like' THEN
    UPDATE catho_private.user_action_limits
    SET
      comment_like_count=CASE WHEN comment_like_window_started_at IS NULL OR comment_like_window_started_at<=now_at-interval '1 hour' THEN 1 ELSE LEAST(comment_like_count+1,maximum_count+1) END,
      comment_like_window_started_at=CASE WHEN comment_like_window_started_at IS NULL OR comment_like_window_started_at<=now_at-interval '1 hour' THEN now_at ELSE comment_like_window_started_at END
    WHERE user_id=actor RETURNING comment_like_count INTO current_count;

  ELSIF action_name='topic_like' THEN
    UPDATE catho_private.user_action_limits
    SET
      topic_like_count=CASE WHEN topic_like_window_started_at IS NULL OR topic_like_window_started_at<=now_at-interval '1 hour' THEN 1 ELSE LEAST(topic_like_count+1,maximum_count+1) END,
      topic_like_window_started_at=CASE WHEN topic_like_window_started_at IS NULL OR topic_like_window_started_at<=now_at-interval '1 hour' THEN now_at ELSE topic_like_window_started_at END
    WHERE user_id=actor RETURNING topic_like_count INTO current_count;

  ELSE
    UPDATE catho_private.user_action_limits
    SET
      appeal_count=CASE WHEN appeal_window_started_at IS NULL OR appeal_window_started_at<=now_at-interval '24 hours' THEN 1 ELSE LEAST(appeal_count+1,maximum_count+1) END,
      appeal_window_started_at=CASE WHEN appeal_window_started_at IS NULL OR appeal_window_started_at<=now_at-interval '24 hours' THEN now_at ELSE appeal_window_started_at END
    WHERE user_id=actor RETURNING appeal_count INTO current_count;
  END IF;

  IF action_name<>'comment' AND current_count>maximum_count THEN
    RAISE EXCEPTION 'Rate limit exceeded for %',action_name USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION catho_private.is_cathoscroll_content_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id=(SELECT auth.uid())
  )
  AND (
    NOT public.admin_mfa_enforcement_enabled()
    OR (
      (SELECT auth.jwt()->>'aal')='aal2'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof((SELECT auth.jwt()->'amr'))='array'
              THEN (SELECT auth.jwt()->'amr')
            ELSE '[]'::jsonb
          END
        ) AS assurance_method
        WHERE assurance_method->>'method'='totp'
      )
    )
  )
$function$

CREATE OR REPLACE FUNCTION catho_private.prevent_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN RAISE EXCEPTION 'Administrator audit records are append-only' USING ERRCODE='42501'; END;$function$

CREATE OR REPLACE FUNCTION catho_private.prune_activity(p_user uuid, p_through bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'catho_private'
AS $function$
declare current_head bigint; current_floor bigint;
begin
  select revision, floor_revision into current_head, current_floor
  from catho_private.activity_heads where user_id = p_user for update;
  if not found or p_through is null or p_through < current_floor or p_through > current_head then
    raise exception 'Invalid activity retention boundary';
  end if;
  delete from catho_private.activity_events where user_id = p_user and revision <= p_through;
  update catho_private.activity_heads set floor_revision = p_through where user_id = p_user;
end;
$function$

CREATE OR REPLACE FUNCTION catho_private.prune_due_activity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE
  account record;
  cutoff timestamptz := statement_timestamp() - interval '31 days';
  removed integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1128350799, 1128350803) THEN
    RETURN 0;
  END IF;
  FOR account IN
    SELECT event.user_id
    FROM catho_private.activity_events AS event
    JOIN catho_private.activity_heads AS head
      ON head.user_id = event.user_id
      AND event.revision = head.floor_revision + 1
    WHERE event.created_at <= cutoff
    ORDER BY event.created_at, event.user_id, event.revision
    LIMIT 25
  LOOP
    removed := removed + catho_private.prune_old_activity(account.user_id, cutoff, 1000);
  END LOOP;
  RETURN removed;
END;
$function$

CREATE OR REPLACE FUNCTION catho_private.prune_old_activity(p_user uuid, p_before timestamp with time zone, p_limit integer DEFAULT 1000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'catho_private'
AS $function$
declare current_head bigint; current_floor bigint; first_revision bigint;
  last_revision bigint; row_count bigint;
begin
  if p_user is null or p_before is null or p_before > clock_timestamp() - interval '30 days'
    or p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Invalid activity retention parameters';
  end if;
  select revision, floor_revision into current_head, current_floor
  from catho_private.activity_heads where user_id = p_user for update;
  if not found then return 0; end if;
  with candidates as (
    select revision, created_at from catho_private.activity_events
    where user_id = p_user and revision > current_floor
    order by revision limit p_limit
  ), bounded as (
    select revision, min(revision) filter (where created_at > p_before) over () as first_recent
    from candidates
  )
  select min(revision), max(revision), count(*) into first_revision, last_revision, row_count
  from bounded where first_recent is null or revision < first_recent;
  if row_count = 0 then return 0; end if;
  if first_revision <> current_floor + 1 or last_revision > current_head
    or row_count <> last_revision - current_floor then
    raise exception 'Activity history is incomplete';
  end if;
  delete from catho_private.activity_events
  where user_id = p_user and revision <= last_revision;
  update catho_private.activity_heads set floor_revision = last_revision where user_id = p_user;
  return row_count::integer;
end;
$function$

CREATE OR REPLACE FUNCTION catho_private.record_activity(p_user uuid, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'catho_private'
AS $function$
declare next_revision bigint;
begin
  insert into catho_private.activity_heads as head (user_id, revision)
  values (p_user, 1)
  on conflict (user_id) do update set revision = head.revision + 1
  returning revision into next_revision;
  insert into catho_private.activity_events (user_id, revision, kind, topic_id, value, completed_at)
  values (p_user, next_revision, p_kind, p_topic, p_value, p_completed_at);
  return next_revision;
end;
$function$

CREATE OR REPLACE FUNCTION catho_private.validate_comment_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  parent_topic_id text;
  parent_deleted boolean;
  ancestor_count integer;
BEGIN
  IF actor IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.user_id IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Cannot create a comment for another user' USING ERRCODE = '42501';
      END IF;
      IF NEW.is_deleted IS DISTINCT FROM false
         OR NEW.is_pinned IS DISTINCT FROM false
         OR NEW.edited_at IS NOT NULL THEN
        RAISE EXCEPTION 'Comment moderation fields are server-controlled' USING ERRCODE = '42501';
      END IF;
      NEW.created_at := pg_catalog.now();
      NEW.edited_at := NULL;
      IF NOT EXISTS (
        SELECT 1
        FROM public.topics AS topic
        JOIN public.categories AS category
          ON category.slug = topic.category_slug
         AND category.is_published = true
        WHERE topic.id = NEW.topic_id
          AND topic.is_published = true
      ) THEN
        RAISE EXCEPTION 'Comments are only allowed on published topics' USING ERRCODE = '42501';
      END IF;
      IF NEW.parent_id IS NOT NULL THEN
        SELECT parent.topic_id, parent.is_deleted
          INTO parent_topic_id, parent_deleted
        FROM public.comments AS parent
        WHERE parent.id = NEW.parent_id
        FOR KEY SHARE;
        IF NOT FOUND OR parent_topic_id IS DISTINCT FROM NEW.topic_id THEN
          RAISE EXCEPTION 'Reply parent must belong to the same topic' USING ERRCODE = '23514';
        END IF;
        IF parent_deleted THEN
          RAISE EXCEPTION 'Cannot reply to a deleted comment' USING ERRCODE = '23514';
        END IF;
        WITH RECURSIVE parent_chain AS (
          SELECT comment.id, comment.parent_id, comment.topic_id,
                 ARRAY[comment.id]::bigint[] AS visited
          FROM public.comments AS comment
          WHERE comment.id = NEW.parent_id
          UNION ALL
          SELECT parent.id, parent.parent_id, parent.topic_id, chain.visited || parent.id
          FROM parent_chain AS chain
          JOIN public.comments AS parent
            ON parent.id = chain.parent_id
           AND parent.topic_id = NEW.topic_id
          WHERE NOT parent.id = ANY(chain.visited)
            AND pg_catalog.cardinality(chain.visited) < 4
        )
        SELECT count(*)::integer INTO ancestor_count FROM parent_chain;
        IF ancestor_count > 2 THEN
          RAISE EXCEPTION 'Maximum comment reply depth exceeded' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSE
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
         OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned THEN
        RAISE EXCEPTION 'Comment ownership and moderation fields cannot be changed by users'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
         AND NOT (OLD.is_deleted = false AND NEW.is_deleted = true) THEN
        RAISE EXCEPTION 'Comments may only be soft-deleted, not restored by their author'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.is_deleted AND NEW.content IS DISTINCT FROM OLD.content THEN
        RAISE EXCEPTION 'Comment content cannot be changed while deleting it'
          USING ERRCODE = '42501';
      END IF;
      IF OLD.is_deleted AND NEW.content IS DISTINCT FROM OLD.content THEN
        RAISE EXCEPTION 'Deleted comments cannot be edited' USING ERRCODE = '42501';
      END IF;
      IF NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.edited_at := pg_catalog.now();
      ELSE
        NEW.edited_at := OLD.edited_at;
      END IF;
    END IF;

    IF NEW.content IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(NEW.content)) < 1
       OR pg_catalog.char_length(NEW.content) > 2000 THEN
      RAISE EXCEPTION 'Comment content must be between 1 and 2000 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION catho_private.validate_notification_read_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL THEN RETURN NEW; END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
     OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Notification content and ownership are server-controlled'
      USING ERRCODE='42501';
  END IF;

  IF OLD.read_at IS NOT NULL THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
      RAISE EXCEPTION 'A read notification cannot be marked unread'
        USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'Notifications can only be marked as read'
      USING ERRCODE='42501';
  END IF;

  NEW.read_at:=pg_catalog.now();
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_get_action_audit(p_actor_user_id uuid, p_before_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, actor_user_id uuid, action text, target_type text, target_id text, target_user_id uuid, details jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM catho_private.admin_owners WHERE user_id=p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION 'Invalid audit page size' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT audit.id,audit.actor_user_id,audit.action,audit.target_type,
         audit.target_id,audit.target_user_id,audit.details,audit.created_at
  FROM catho_private.admin_action_audit AS audit
  WHERE p_before_id IS NULL OR audit.id<p_before_id
  ORDER BY audit.id DESC
  LIMIT p_limit;
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_manage_comment_ban(target_user_id uuid, moderator_user_id uuid, moderation_action text, moderation_reason text, hide_existing_comments boolean, restore_hidden_comments boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  active_ban_id bigint;
  changed_comment_count integer := 0;
BEGIN
  IF moderation_action IS NULL OR moderation_action NOT IN ('ban', 'unban') THEN
    RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE = '22023';
  END IF;

  IF target_user_id IS NULL
     OR moderator_user_id IS NULL
     OR moderation_reason IS NULL
     OR char_length(btrim(moderation_reason)) < 5
     OR char_length(moderation_reason) > 1000 THEN
    RAISE EXCEPTION 'Invalid comment restriction details' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = moderator_user_id
  ) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF moderation_action = 'ban' THEN
    IF target_user_id = moderator_user_id THEN
      RAISE EXCEPTION 'Cannot restrict your own account' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.user_comment_bans (user_id, banned_by, reason)
    VALUES (target_user_id, moderator_user_id, btrim(moderation_reason))
    RETURNING id INTO active_ban_id;

    IF hide_existing_comments THEN
      WITH newly_hidden AS (
        UPDATE public.comments
        SET is_deleted = true
        WHERE user_id = target_user_id
          AND is_deleted = false
        RETURNING id
      )
      INSERT INTO public.user_comment_ban_hidden_comments (ban_id, comment_id, was_deleted)
      SELECT active_ban_id, id, false
      FROM newly_hidden;

      GET DIAGNOSTICS changed_comment_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
      'banned', true,
      'hiddenCommentCount', changed_comment_count
    );
  END IF;

  SELECT id INTO active_ban_id
  FROM public.user_comment_bans
  WHERE user_id = target_user_id
    AND unbanned_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active comment restriction not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_comment_bans
  SET unbanned_at = now(),
      unbanned_by = moderator_user_id,
      unban_reason = btrim(moderation_reason)
  WHERE id = active_ban_id;

  IF restore_hidden_comments THEN
    UPDATE public.comments AS comment
    SET is_deleted = hidden.was_deleted
    FROM public.user_comment_ban_hidden_comments AS hidden
    WHERE hidden.ban_id = active_ban_id
      AND hidden.comment_id = comment.id
      AND comment.is_deleted = true;

    GET DIAGNOSTICS changed_comment_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'banned', false,
    'restoredCommentCount', changed_comment_count
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_mfa_enforcement_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT admin_mfa_enforced FROM catho_private.security_controls WHERE singleton=true),false)
$function$

CREATE OR REPLACE FUNCTION public.admin_review_comment_ban_appeal(target_appeal_id bigint, approve_appeal boolean, reviewer_user_id uuid, review_note text, restore_hidden_comments boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_user_id uuid;
  target_ban_id bigint;
  current_status text;
  next_status text;
BEGIN
  IF approve_appeal IS NULL
     OR (review_note IS NOT NULL AND char_length(review_note) > 1000) THEN
    RAISE EXCEPTION 'Invalid appeal decision' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = reviewer_user_id
  ) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, ban_id, status
  INTO target_user_id, target_ban_id, current_status
  FROM public.comment_ban_appeals
  WHERE id = target_appeal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appeal not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_status <> 'pending' THEN
    RAISE EXCEPTION 'Appeal has already been reviewed' USING ERRCODE = '23505';
  END IF;

  next_status := CASE WHEN approve_appeal THEN 'approved' ELSE 'dismissed' END;

  UPDATE public.comment_ban_appeals
  SET status = next_status,
      admin_note = NULLIF(btrim(review_note), ''),
      reviewed_by = reviewer_user_id,
      reviewed_at = now()
  WHERE id = target_appeal_id;

  IF approve_appeal THEN
    UPDATE public.user_comment_bans
    SET unbanned_at = now(),
        unbanned_by = reviewer_user_id,
        unban_reason = 'Appeal approved'
    WHERE id = target_ban_id
      AND user_id = target_user_id
      AND unbanned_at IS NULL;

    IF restore_hidden_comments THEN
      UPDATE public.comments AS comment
      SET is_deleted = hidden.was_deleted
      FROM public.user_comment_ban_hidden_comments AS hidden
      WHERE hidden.ban_id = target_ban_id
        AND hidden.comment_id = comment.id
        AND comment.is_deleted = true;
    END IF;
  END IF;

  RETURN next_status;
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_review_comment_report(target_report_id bigint, review_action text, reviewer_user_id uuid, review_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_comment_id bigint;
  current_status text;
  next_status text;
BEGIN
  IF review_action IS NULL OR review_action NOT IN ('dismiss', 'resolve', 'hide') THEN
    RAISE EXCEPTION 'Invalid report action' USING ERRCODE = '22023';
  END IF;

  IF review_note IS NOT NULL AND char_length(review_note) > 1000 THEN
    RAISE EXCEPTION 'Admin note is too long' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = reviewer_user_id
  ) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT comment_id, status
    INTO target_comment_id, current_status
    FROM public.comment_reports
    WHERE id = target_report_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_status NOT IN ('pending', 'reviewing') THEN
    RAISE EXCEPTION 'Report has already been reviewed' USING ERRCODE = '23505';
  END IF;

  IF review_action = 'hide' THEN
    UPDATE public.comments SET is_deleted = true WHERE id = target_comment_id;
  END IF;

  next_status := CASE WHEN review_action = 'dismiss' THEN 'dismissed' ELSE 'resolved' END;

  UPDATE public.comment_reports
    SET status = next_status,
        admin_note = NULLIF(btrim(review_note), ''),
        reviewed_by = reviewer_user_id,
        reviewed_at = now()
    WHERE id = target_report_id;

  RETURN next_status;
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_set_comment_pin(target_comment_id bigint, should_pin boolean, moderator_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_topic_id text;
BEGIN
  IF moderator_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = moderator_user_id
  ) THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT comment.topic_id
    INTO target_topic_id
  FROM public.comments AS comment
  WHERE comment.id = target_comment_id
    AND comment.parent_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-level comment not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_topic_id, 0::bigint)
  );

  PERFORM 1
  FROM public.comments AS comment
  WHERE comment.id = target_comment_id
    AND comment.parent_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-level comment not found' USING ERRCODE = 'P0002';
  END IF;

  IF should_pin THEN
    UPDATE public.comments
    SET is_pinned = false
    WHERE topic_id = target_topic_id
      AND parent_id IS NULL
      AND is_pinned = true;

    UPDATE public.comments
    SET is_pinned = true
    WHERE id = target_comment_id;
  ELSE
    UPDATE public.comments
    SET is_pinned = false
    WHERE id = target_comment_id;
  END IF;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, target_user_id, details)
  VALUES (
    moderator_user_id,
    CASE WHEN should_pin THEN 'comment.pinned' ELSE 'comment.unpinned' END,
    'comments',
    target_comment_id::text,
    NULL,
    jsonb_build_object('topic_id', target_topic_id)
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_actor_user_id uuid, p_grant boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE changed_count integer:=0;
BEGIN
  IF p_target_user_id IS NULL OR p_actor_user_id IS NULL OR p_grant IS NULL OR p_target_user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Invalid administrator role change' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM catho_private.admin_owners WHERE user_id=p_actor_user_id) THEN
    RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_target_user_id) THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE='P0002';
  END IF;
  IF p_grant THEN
    IF NOT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=p_target_user_id AND factor_type='totp' AND status='verified') THEN
      RAISE EXCEPTION 'Target account must verify MFA before receiving administrator access' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.admin_users(user_id) VALUES(p_target_user_id) ON CONFLICT(user_id) DO NOTHING;
    GET DIAGNOSTICS changed_count=ROW_COUNT;
  ELSE
    IF EXISTS(SELECT 1 FROM catho_private.admin_owners WHERE user_id=p_target_user_id) THEN
      RAISE EXCEPTION 'The owner account cannot be revoked' USING ERRCODE='42501';
    END IF;
    DELETE FROM public.admin_users WHERE user_id=p_target_user_id;
    GET DIAGNOSTICS changed_count=ROW_COUNT;
  END IF;
  INSERT INTO catho_private.admin_action_audit(actor_user_id,action,target_type,target_id,target_user_id,details)
  VALUES(p_actor_user_id,CASE WHEN p_grant THEN 'admin_role.granted' ELSE 'admin_role.revoked' END,'admin_users',p_target_user_id::text,p_target_user_id,jsonb_build_object('changed',changed_count));
  RETURN jsonb_build_object('success',true,'is_admin',p_grant,'changed',changed_count);
END;
$function$

CREATE OR REPLACE FUNCTION public.admin_user_has_verified_totp(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id=p_user_id AND factor_type='totp' AND status='verified'
  )
$function$

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_key_hash text, p_limit integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  now_at timestamptz:=pg_catalog.clock_timestamp();
  current_started_at timestamptz;
  current_count integer;
  retry_seconds integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_limit IS NULL OR p_limit<1 OR p_limit>10000
     OR p_window_seconds IS NULL OR p_window_seconds<1 OR p_window_seconds>86400 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters' USING ERRCODE='22023';
  END IF;
  INSERT INTO catho_private.api_rate_limits AS existing
    (key_hash,window_started_at,request_count,updated_at)
  VALUES(p_key_hash,now_at,1,now_at)
  ON CONFLICT(key_hash) DO UPDATE SET
    window_started_at=CASE WHEN existing.window_started_at<=now_at-pg_catalog.make_interval(secs=>p_window_seconds) THEN now_at ELSE existing.window_started_at END,
    request_count=CASE WHEN existing.window_started_at<=now_at-pg_catalog.make_interval(secs=>p_window_seconds) THEN 1 ELSE LEAST(existing.request_count+1,p_limit+1) END,
    updated_at=now_at
  RETURNING existing.window_started_at,existing.request_count INTO current_started_at,current_count;
  retry_seconds:=GREATEST(1,CEIL(EXTRACT(EPOCH FROM(current_started_at+pg_catalog.make_interval(secs=>p_window_seconds)-now_at)))::integer);
  RETURN QUERY SELECT current_count<=p_limit,CASE WHEN current_count<=p_limit THEN 0 ELSE retry_seconds END;
  DELETE FROM catho_private.api_rate_limits stale
  WHERE stale.key_hash IN (
    SELECT candidate.key_hash FROM catho_private.api_rate_limits candidate
    WHERE candidate.updated_at<now_at-interval '2 days'
    ORDER BY candidate.updated_at LIMIT 100
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.enable_admin_mfa_enforcement(p_actor_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM catho_private.admin_owners WHERE user_id=p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Owner permission required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id=p_actor_user_id AND factor_type='totp' AND status='verified'
  ) THEN
    RAISE EXCEPTION 'Verify an authenticator factor before enforcing administrator MFA' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.admin_users AS administrator
    WHERE NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors AS factor
      WHERE factor.user_id=administrator.user_id
        AND factor.factor_type='totp'
        AND factor.status='verified'
    )
  ) THEN
    RAISE EXCEPTION 'Every administrator must verify a TOTP authenticator before enforcement' USING ERRCODE='23514';
  END IF;
  UPDATE catho_private.security_controls
  SET admin_mfa_enforced=true,updated_at=pg_catalog.now()
  WHERE singleton=true;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id,action,target_type,target_id,target_user_id,details)
  VALUES(p_actor_user_id,'security.admin_mfa_enforced','security_controls','admin_mfa',p_actor_user_id,'{}'::jsonb);
  RETURN true;
END;
$function$

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
  initial_page boolean := feed_cursor IS NULL;
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

  IF initial_page THEN
    -- Freeze category preferences for this feed cursor.
    WITH signals AS (
      SELECT p.topic_id, 5 AS weight
      FROM public.progress p
      WHERE p.user_id = current_user_id

      UNION ALL

      SELECT b.topic_id, 4
      FROM public.bookmarks b
      WHERE b.user_id = current_user_id

      UNION ALL

      SELECT l.topic_id, 3
      FROM public.topic_likes l
      WHERE l.user_id = current_user_id

      UNION ALL

      SELECT DISTINCT c.topic_id, 3
      FROM public.comments c
      WHERE c.user_id = current_user_id
        AND c.is_deleted = false
    ), preferences AS (
      SELECT t.category_slug, sum(s.weight) AS weight
      FROM signals s
      JOIN public.topics t
        ON t.id = s.topic_id AND t.is_published
      JOIN public.categories c
        ON c.slug = t.category_slug AND c.is_published
      GROUP BY t.category_slug
    )
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', c.slug,
          'weight', 1 + sqrt(coalesce(p.weight, 0)::numeric),
          'served', 0,
          'order', NULL,
          'id', NULL
        ) ORDER BY c.slug
      ),
      '[]'::jsonb
    )
    INTO categories
    FROM public.categories c
    LEFT JOIN preferences p ON p.category_slug = c.slug
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
$function$

CREATE OR REPLACE FUNCTION public.get_my_topic_engagement()
 RETURNS TABLE(progress_topic_ids text[], bookmark_topic_ids text[], liked_topic_ids text[], commented_topic_ids text[])
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    COALESCE(
      (
        SELECT pg_catalog.array_agg(DISTINCT p.topic_id::text)
        FROM public.progress AS p
        WHERE p.user_id = (SELECT auth.uid())
          AND p.topic_id IS NOT NULL
      ),
      ARRAY[]::text[]
    ),
    COALESCE(
      (
        SELECT pg_catalog.array_agg(DISTINCT b.topic_id::text)
        FROM public.bookmarks AS b
        WHERE b.user_id = (SELECT auth.uid())
          AND b.topic_id IS NOT NULL
      ),
      ARRAY[]::text[]
    ),
    COALESCE(
      (
        SELECT pg_catalog.array_agg(DISTINCT l.topic_id::text)
        FROM public.topic_likes AS l
        WHERE l.user_id = (SELECT auth.uid())
          AND l.topic_id IS NOT NULL
      ),
      ARRAY[]::text[]
    ),
    COALESCE(
      (
        SELECT pg_catalog.array_agg(DISTINCT c.topic_id::text)
        FROM public.comments AS c
        WHERE c.user_id = (SELECT auth.uid())
          AND c.is_deleted = false
          AND c.topic_id IS NOT NULL
      ),
      ARRAY[]::text[]
    );
$function$

CREATE OR REPLACE FUNCTION public.get_own_subscription_tier()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.subscription_tier
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
$function$

CREATE OR REPLACE FUNCTION public.get_public_profile_metrics(p_profile_id uuid, p_timezone text DEFAULT 'UTC'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
    SELECT progress.completed_at
    FROM public.progress AS progress
    JOIN public.topics AS topic
      ON topic.id = progress.topic_id
     AND topic.is_published = true
    JOIN public.categories AS category
      ON category.slug = topic.category_slug
     AND category.is_published = true
    WHERE progress.user_id = p_profile_id
      AND progress.completed_at IS NOT NULL
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
      FROM public.bookmarks AS bookmark
      JOIN public.topics AS topic
        ON topic.id = bookmark.topic_id
       AND topic.is_published = true
      JOIN public.categories AS category
        ON category.slug = topic.category_slug
       AND category.is_published = true
      WHERE bookmark.user_id = p_profile_id
    ),
    'comment_count', (
      SELECT count(*)
      FROM public.comments AS comment
      JOIN public.topics AS topic
        ON topic.id = comment.topic_id
       AND topic.is_published = true
      JOIN public.categories AS category
        ON category.slug = topic.category_slug
       AND category.is_published = true
      WHERE comment.user_id = p_profile_id
        AND comment.is_deleted = false
    ),
    'likes_received', (
      SELECT count(*)
      FROM public.comment_likes AS comment_like
      JOIN public.comments AS comment
        ON comment.id = comment_like.comment_id
       AND comment.is_deleted = false
      JOIN public.topics AS topic
        ON topic.id = comment.topic_id
       AND topic.is_published = true
      JOIN public.categories AS category
        ON category.slug = topic.category_slug
       AND category.is_published = true
      WHERE comment.user_id = p_profile_id
    ),
    'current_streak', (SELECT value FROM current_streak),
    'longest_streak', (SELECT value FROM longest_streak),
    'recent_progress', (SELECT value FROM recent_progress),
    'recent_comments', (SELECT value FROM recent_comments)
  )
  INTO metrics;

  RETURN metrics;
END
$function$

CREATE OR REPLACE FUNCTION public.get_topic_comment_page(p_topic_id text, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  page_size integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  result jsonb;
BEGIN
  IF p_topic_id IS NULL OR pg_catalog.length(p_topic_id) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A valid topic ID is required' USING ERRCODE = '22023';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Comment cursor is incomplete' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.topics AS topic
    JOIN public.categories AS category
      ON category.slug = topic.category_slug
     AND category.is_published = true
    WHERE topic.id = p_topic_id
      AND topic.is_published = true
  ) THEN
    RETURN jsonb_build_object(
      'comments', '[]'::jsonb,
      'has_more', false,
      'next_cursor', NULL,
      'total_count', 0
    );
  END IF;

  WITH RECURSIVE
  page_candidates AS (
    SELECT
      comment.id,
      comment.topic_id,
      comment.user_id,
      comment.parent_id,
      comment.content,
      comment.created_at,
      comment.edited_at,
      comment.is_deleted,
      comment.is_pinned
    FROM public.comments AS comment
    WHERE comment.topic_id = p_topic_id
      AND comment.is_pinned = false
      AND (
        p_before_created_at IS NULL
        OR (comment.created_at, comment.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY comment.created_at DESC, comment.id DESC
    LIMIT page_size + 1
  ),
  selected_page AS (
    SELECT *
    FROM page_candidates
    ORDER BY created_at DESC, id DESC
    LIMIT page_size
  ),
  pinned_comments AS (
    SELECT
      comment.id,
      comment.topic_id,
      comment.user_id,
      comment.parent_id,
      comment.content,
      comment.created_at,
      comment.edited_at,
      comment.is_deleted,
      comment.is_pinned
    FROM public.comments AS comment
    WHERE comment.topic_id = p_topic_id
      AND comment.is_pinned = true
  ),
  selected_comments AS (
    SELECT * FROM selected_page
    UNION ALL
    SELECT * FROM pinned_comments
  ),
  ancestors (
    id,
    topic_id,
    user_id,
    parent_id,
    content,
    created_at,
    edited_at,
    is_deleted,
    is_pinned,
    depth
  ) AS (
    SELECT
      parent.id,
      parent.topic_id,
      parent.user_id,
      parent.parent_id,
      parent.content,
      parent.created_at,
      parent.edited_at,
      parent.is_deleted,
      parent.is_pinned,
      1
    FROM selected_comments AS child
    JOIN public.comments AS parent
      ON parent.id = child.parent_id
     AND parent.topic_id = p_topic_id

    UNION ALL

    SELECT
      parent.id,
      parent.topic_id,
      parent.user_id,
      parent.parent_id,
      parent.content,
      parent.created_at,
      parent.edited_at,
      parent.is_deleted,
      parent.is_pinned,
      ancestors.depth + 1
    FROM ancestors
    JOIN public.comments AS parent
      ON parent.id = ancestors.parent_id
     AND parent.topic_id = p_topic_id
    WHERE ancestors.depth < 10
  ),
  raw_rows AS (
    SELECT
      id, topic_id, user_id, parent_id, content, created_at, edited_at,
      is_deleted, is_pinned, false AS is_context
    FROM selected_comments

    UNION ALL

    SELECT
      id, topic_id, user_id, parent_id, content, created_at, edited_at,
      is_deleted, is_pinned, true AS is_context
    FROM ancestors
  ),
  deduplicated_rows AS (
    SELECT DISTINCT ON (id)
      id, topic_id, user_id, parent_id, content, created_at, edited_at,
      is_deleted, is_pinned, is_context
    FROM raw_rows
    ORDER BY id, is_context
  ),
  enriched_rows AS (
    SELECT
      row_data.*,
      CASE
        WHEN row_data.is_deleted THEN 0::bigint
        ELSE (
          SELECT count(*)
          FROM public.comment_likes AS comment_like
          WHERE comment_like.comment_id = row_data.id
        )
      END AS likes,
      CASE
        WHEN row_data.is_deleted THEN false
        ELSE EXISTS (
          SELECT 1
          FROM public.comment_likes AS comment_like
          WHERE comment_like.comment_id = row_data.id
            AND comment_like.user_id = (SELECT auth.uid())
        )
      END AS liked_by_user
    FROM deduplicated_rows AS row_data
  ),
  page_metadata AS (
    SELECT count(*) > page_size AS has_more
    FROM page_candidates
  ),
  cursor_row AS (
    SELECT created_at, id
    FROM selected_page
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  ),
  comment_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'topic_id', topic_id,
          'user_id', user_id,
          'parent_id', parent_id,
          'content', CASE WHEN is_deleted THEN ''::text ELSE content END,
          'created_at', created_at,
          'edited_at', edited_at,
          'is_deleted', is_deleted,
          'is_pinned', is_pinned,
          'likes', likes,
          'liked_by_user', liked_by_user
        )
        ORDER BY created_at DESC, id DESC
      ),
      '[]'::jsonb
    ) AS value
    FROM enriched_rows
  )
  SELECT jsonb_build_object(
    'comments', (SELECT value FROM comment_json),
    'has_more', (SELECT has_more FROM page_metadata),
    'next_cursor', CASE
      WHEN (SELECT has_more FROM page_metadata) THEN (
        SELECT jsonb_build_object('created_at', created_at, 'id', id)
        FROM cursor_row
      )
      ELSE NULL
    END,
    'total_count', (
      SELECT count(*)
      FROM public.comments
      WHERE topic_id = p_topic_id
    )
  )
  INTO result;

  RETURN result;
END
$function$

CREATE OR REPLACE FUNCTION public.get_topic_like_state(p_topic_id text)
 RETURNS TABLE(likes bigint, liked boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    count(topic_like.id)::bigint AS likes,
    COALESCE(bool_or(topic_like.user_id = (SELECT auth.uid())), false) AS liked
  FROM public.topics AS topic
  JOIN public.categories AS category
    ON category.slug = topic.category_slug
   AND category.is_published = true
  LEFT JOIN public.topic_likes AS topic_like
    ON topic_like.topic_id = topic.id
  WHERE topic.id = p_topic_id
    AND topic.is_published = true
    AND p_topic_id IS NOT NULL
    AND pg_catalog.length(p_topic_id) BETWEEN 1 AND 100
$function$

CREATE OR REPLACE FUNCTION public.is_cathoscroll_admin_owner(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM catho_private.admin_owners owner_row
    WHERE owner_row.user_id = p_user_id
  )
$function$

CREATE OR REPLACE FUNCTION public.is_cathoscroll_content_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT catho_private.is_cathoscroll_content_admin()
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_appeal_reviewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    if new.status = 'approved'
       and exists (
         select 1
         from public.notifications n
         where n.user_id = new.user_id
           and n.type = 'comment_unbanned'
           and n.created_at >= transaction_timestamp()
       ) then
      return new;
    end if;

    insert into public.notifications (user_id, type, title, body)
    values (
      new.user_id,
      case when new.status = 'approved' then 'appeal_approved' else 'appeal_dismissed' end,
      case
        when new.status = 'approved' then 'Your appeal was approved'
        else 'Your appeal was reviewed'
      end,
      case
        when new.status = 'approved' then 'Your comment restriction has been lifted.'
        else 'A moderator reviewed your appeal. You can view the decision in your account notifications.'
      end
    );
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_pin_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.is_pinned is not distinct from old.is_pinned then
    return new;
  end if;

  insert into public.notifications (
    user_id, type, title, body, topic_id, comment_id
  )
  values (
    new.user_id,
    case when new.is_pinned then 'comment_pinned' else 'comment_unpinned' end,
    case when new.is_pinned then 'Your comment was pinned' else 'Your comment was unpinned' end,
    case
      when new.is_pinned then 'A moderator pinned your comment.'
      else 'A moderator unpinned your comment.'
    end,
    new.topic_id::text,
    new.id
  );

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  parent_user_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select c.user_id
    into parent_user_id
    from public.comments as c
   where c.id = new.parent_id;

  if parent_user_id is not null and parent_user_id <> new.user_id then
    insert into public.notifications (
      user_id, type, title, body, topic_id, comment_id
    )
    values (
      parent_user_id,
      'reply',
      'Someone replied to your comment',
      'Open the discussion to read the reply.',
      new.topic_id::text,
      new.id
    );
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_report_reviewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if old.status in ('pending', 'reviewing')
     and new.status not in ('pending', 'reviewing') then
    insert into public.notifications (user_id, type, title, body)
    values (
      new.reporter_id,
      'report_reviewed',
      'Your comment report was reviewed',
      format('A moderator reviewed your report. Its status is now %s.', new.status)
    );
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_restriction_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  insert into public.notifications (user_id, type, title, body)
  values (
    new.user_id,
    'comment_banned',
    'Comment access restricted',
    'A moderator restricted your ability to post or reply to comments. You can request a review from the appeal page.'
  );

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_comment_restriction_lifted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if old.unbanned_at is null and new.unbanned_at is not null
     and not exists (
       select 1
       from public.notifications n
       where n.user_id = new.user_id
         and n.type = 'appeal_approved'
         and n.created_at >= transaction_timestamp()
     ) then
    insert into public.notifications (user_id, type, title, body)
    values (
      new.user_id,
      'comment_unbanned',
      'Comment restriction lifted',
      'Your comment access has been restored.'
    );
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_moderated_comment_visibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
begin
  insert into public.notifications (user_id, type, title, body)
  select
    changed.user_id,
    case when changed.is_deleted then 'comment_hidden' else 'comment_restored' end,
    case
      when changed.is_deleted then 'A moderator hid your comments'
      else 'A moderator restored your comments'
    end,
    case
      when changed.is_deleted then
        format('A moderator hid %s of your comments. You can review your comment access on the appeal page.', changed.comment_count)
      else
        format('A moderator restored %s of your comments.', changed.comment_count)
    end
  from (
    select n.user_id, n.is_deleted, count(*) as comment_count
      from new_rows as n
      join old_rows as o on o.id = n.id
     where o.is_deleted is distinct from n.is_deleted
       and auth.uid() is distinct from n.user_id
     group by n.user_id, n.is_deleted
  ) as changed;

  return null;
end;
$function$

CREATE OR REPLACE FUNCTION public.notify_profile_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  insert into public.notifications (user_id, type, title, body)
  values (
    new.id,
    'welcome',
    'Welcome to notifications',
    'This is your notification area. Replies and important account updates will appear here.'
  );

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.offline_activity_changes(p_user uuid, p_after text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
declare actor uuid := auth.uid(); after_revision bigint; current_revision bigint; retained_floor bigint; items jsonb; more boolean;
begin
  if actor is null or actor is distinct from p_user then
    raise exception 'Account does not match' using errcode = '42501';
  end if;
  if p_after is null or p_after !~ '^(0|[1-9][0-9]{0,18})$'
    or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid activity cursor or limit';
  end if;
  after_revision := p_after::bigint;
  select revision, floor_revision into current_revision, retained_floor
  from catho_private.activity_heads where user_id = actor;
  if after_revision > coalesce(current_revision, 0) then
    raise exception 'Activity cursor is ahead of the server';
  end if;
  if after_revision < coalesce(retained_floor, 0) then
    return jsonb_build_object('userId', actor, 'changes', '[]'::jsonb, 'hasMore', false, 'resetRequired', true);
  end if;
  with entries as (
    select revision, kind, topic_id, value, completed_at
    from catho_private.activity_events
    where user_id = actor and revision > after_revision
    order by revision limit (p_limit + 1)
  ), page as (
    select * from entries order by revision limit p_limit
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
      'revision', revision::text, 'kind', kind, 'topicId', topic_id, 'value', value, 'completedAt', completed_at
    ) order by revision) from page), '[]'::jsonb),
    (select count(*) > p_limit from entries)
  into items, more;
  return jsonb_build_object('userId', actor, 'changes', items, 'hasMore', more);
end;
$function$

CREATE OR REPLACE FUNCTION public.offline_activity_head(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
declare actor uuid := auth.uid(); result bigint;
begin
  if actor is null or actor is distinct from p_user then
    raise exception 'Account does not match' using errcode = '42501';
  end if;
  select revision into result from catho_private.activity_heads where user_id = actor;
  return jsonb_build_object('userId', actor, 'revision', coalesce(result, 0)::text);
end;
$function$

CREATE OR REPLACE FUNCTION public.offline_activity_snapshot(p_user uuid, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
declare actor uuid := auth.uid(); cursor_value jsonb; after_kind text; after_topic text;
  items jsonb; next_cursor text;
begin
  if actor is null or actor is distinct from p_user then
    raise exception 'Account does not match' using errcode = '42501';
  end if;
  if p_cursor is not null then
    if length(p_cursor) > 4096 then raise exception 'Invalid snapshot cursor'; end if;
    cursor_value := p_cursor::jsonb;
    if jsonb_typeof(cursor_value) <> 'array' or jsonb_array_length(cursor_value) <> 2
      or jsonb_typeof(cursor_value->0) <> 'string' or jsonb_typeof(cursor_value->1) <> 'string'
    then raise exception 'Invalid snapshot cursor'; end if;
    after_kind := cursor_value->>0;
    after_topic := cursor_value->>1;
    if after_kind not in ('bookmark', 'like', 'progress') or after_topic = '' then
      raise exception 'Invalid snapshot cursor';
    end if;
  end if;
  with entries as (
    select 'bookmark'::text as kind, topic_id, null::timestamptz as completed_at from public.bookmarks where user_id = actor
    union all
    select 'like'::text as kind, topic_id, null::timestamptz as completed_at from public.topic_likes where user_id = actor
    union all
    select 'progress'::text as kind, topic_id, completed_at from public.progress where user_id = actor
  ), bounded as (
    select kind, topic_id, completed_at from entries
    where p_cursor is null or (kind, topic_id) > (after_kind, after_topic)
    order by kind, topic_id limit 101
  ), page as (
    select kind, topic_id, completed_at from bounded order by kind, topic_id limit 100
  )
  select coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'topicId', topic_id, 'completedAt', completed_at)
    order by kind, topic_id) from page), '[]'::jsonb),
    case when (select count(*) from bounded) > 100 then
      (select jsonb_build_array(kind, topic_id)::text from page order by kind desc, topic_id desc limit 1)
    else null end
  into items, next_cursor;
  return jsonb_build_object('userId', actor, 'items', items, 'nextCursor', next_cursor);
end;
$function$

CREATE OR REPLACE FUNCTION public.offline_apply_activity(p_user uuid, p_operation uuid, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
declare actor uuid := auth.uid(); receipt catho_private.activity_receipts%rowtype;
  inserted integer; next_revision bigint; actual_completed_at timestamptz;
begin
  if actor is null or actor is distinct from p_user then
    raise exception 'Account does not match' using errcode = '42501';
  end if;
  if p_operation is null or p_kind is null or p_kind not in ('bookmark', 'like', 'progress')
    or p_topic is null or length(p_topic) < 1 or length(p_topic) > 100
    or btrim(p_topic) <> p_topic or p_value is null
    or ((p_kind = 'progress' and p_value) <> (p_completed_at is not null))
  then raise exception 'Invalid activity operation'; end if;
  insert into catho_private.activity_receipts (user_id, operation_id, kind, topic_id, value, requested_completed_at)
  values (actor, p_operation, p_kind, p_topic, p_value, p_completed_at)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select * into receipt from catho_private.activity_receipts
    where user_id = actor and operation_id = p_operation;
    if receipt.kind is distinct from p_kind or receipt.topic_id is distinct from p_topic
      or receipt.value is distinct from p_value or receipt.requested_completed_at is distinct from p_completed_at
      or receipt.status is null
    then raise exception 'Activity operation ID was reused'; end if;
    if receipt.status = 'rejected' then
      return jsonb_build_object(
        'operationId', p_operation, 'userId', actor,
        'status', 'rejected', 'reason', receipt.rejection_reason
      );
    end if;
    if receipt.revision is null then raise exception 'Invalid activity receipt'; end if;
    return jsonb_build_object(
      'operationId', p_operation, 'userId', actor,
      'status', 'applied', 'revision', receipt.revision::text, 'value', receipt.value, 'completedAt', receipt.completed_at
    );
  end if;
  if p_value then
    perform t.id from public.topics t
    join public.categories c on c.slug = t.category_slug
    where t.id = p_topic and t.is_published and c.is_published
    for share of t, c;
    if not found then
      update catho_private.activity_receipts
      set status = 'rejected', rejection_reason = 'topic_unavailable'
      where user_id = actor and operation_id = p_operation;
      return jsonb_build_object(
        'operationId', p_operation, 'userId', actor,
        'status', 'rejected', 'reason', 'topic_unavailable'
      );
    end if;
  end if;
  if p_kind = 'bookmark' then
    if p_value then
      insert into public.bookmarks (user_id, topic_id) values (actor, p_topic)
      on conflict (user_id, topic_id) do nothing;
    else
      delete from public.bookmarks where user_id = actor and topic_id = p_topic;
    end if;
  elsif p_kind = 'like' then
    if p_value then
      insert into public.topic_likes (user_id, topic_id) values (actor, p_topic)
      on conflict (user_id, topic_id) do nothing;
    else
      delete from public.topic_likes where user_id = actor and topic_id = p_topic;
    end if;
  else
    if p_value then
      insert into public.progress as progress (user_id, topic_id, completed_at)
      values (actor, p_topic, p_completed_at)
      on conflict (user_id, topic_id) do update
      set completed_at = least(progress.completed_at, excluded.completed_at)
      returning completed_at into actual_completed_at;
    else
      delete from public.progress where user_id = actor and topic_id = p_topic;
    end if;
  end if;
  next_revision := catho_private.record_activity(actor, p_kind, p_topic, p_value, actual_completed_at);
  update catho_private.activity_receipts set status = 'applied', revision = next_revision, completed_at = actual_completed_at
  where user_id = actor and operation_id = p_operation;
  return jsonb_build_object(
    'operationId', p_operation, 'userId', actor,
    'status', 'applied', 'revision', next_revision::text, 'value', p_value, 'completedAt', actual_completed_at
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.offline_apply_activity_batch(p_user uuid, p_operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
DECLARE
  actor uuid := auth.uid();
  item jsonb;
  operation_id uuid;
  device_id uuid;
  sequence_value text;
  acknowledged_value text;
  previous_device uuid;
  previous_sequence text;
  initial_acknowledgement text;
  operation_result jsonb;
  results jsonb := '[]'::jsonb;
  completed_at_value timestamptz;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'Account does not match' USING ERRCODE = '42501';
  END IF;
  IF p_operations IS NULL OR jsonb_typeof(p_operations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid offline activity batch size' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_operations) < 1 OR jsonb_array_length(p_operations) > 100
    OR octet_length(p_operations::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid offline activity batch size' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_operations)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'operationId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'deviceId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'sequence') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'acknowledgedSequence') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'topicId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'value') IS DISTINCT FROM 'boolean'
      OR (item ? 'completedAt' AND jsonb_typeof(item->'completedAt') NOT IN ('string', 'null'))
      OR item->>'kind' NOT IN ('bookmark', 'like', 'progress')
      OR (jsonb_typeof(item->'completedAt') = 'string'
        AND length(item->>'completedAt') > 64) THEN
      RAISE EXCEPTION 'Invalid offline activity batch operation' USING ERRCODE = '22023';
    END IF;

    IF item->>'operationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR item->>'deviceId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR item->>'sequence' !~ '^[1-9][0-9]{0,18}$'
      OR item->>'acknowledgedSequence' !~ '^(0|[1-9][0-9]{0,18})$'
      OR length(item->>'topicId') < 1 OR length(item->>'topicId') > 100
      OR btrim(item->>'topicId') <> item->>'topicId' THEN
      RAISE EXCEPTION 'Invalid offline activity batch operation' USING ERRCODE = '22023';
    END IF;

    operation_id := (item->>'operationId')::uuid;
    device_id := (item->>'deviceId')::uuid;
    sequence_value := item->>'sequence';
    acknowledged_value := item->>'acknowledgedSequence';

    -- The acknowledgement remains fixed until the client has persisted all receipts.
    IF previous_device IS NOT NULL
      AND (device_id IS DISTINCT FROM previous_device
        OR acknowledged_value IS DISTINCT FROM initial_acknowledgement
        OR sequence_value::bigint <> previous_sequence::bigint + 1) THEN
      RAISE EXCEPTION 'Offline activity batch sequence is not contiguous' USING ERRCODE = '22023';
    END IF;
    IF previous_device IS NULL THEN
      initial_acknowledgement := acknowledged_value;
    END IF;

    completed_at_value := CASE
      WHEN item->'completedAt' IS NULL OR jsonb_typeof(item->'completedAt') = 'null' THEN NULL
      ELSE (item->>'completedAt')::timestamptz
    END;

    BEGIN
      operation_result := public.offline_apply_activity_v2(
        p_user, operation_id, device_id, sequence_value, acknowledged_value,
        item->>'kind', item->>'topicId', (item->>'value')::boolean, completed_at_value
      );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM ILIKE '%rate limit%' THEN
        results := results || jsonb_build_array(jsonb_build_object(
          'operationId', operation_id, 'userId', actor,
          'status', 'deferred', 'reason', 'rate_limited'
        ));
        RETURN results;
      END IF;
      RAISE;
    END;

    results := results || jsonb_build_array(operation_result);
    previous_device := device_id;
    previous_sequence := sequence_value;
  END LOOP;

  RETURN results;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_apply_activity_v2(p_user uuid, p_operation uuid, p_device uuid, p_sequence text, p_acknowledged text, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'catho_private'
AS $function$
DECLARE
  actor uuid := auth.uid();
  seq bigint;
  ack bigint;
  state catho_private.activity_devices%rowtype;
  mapped uuid;
  result jsonb;
  now_at timestamptz := clock_timestamp();
  sync_count integer;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'Account does not match' USING ERRCODE = '42501';
  END IF;

  IF p_device IS NULL OR p_operation IS NULL
    OR p_sequence IS NULL OR p_sequence !~ '^[1-9][0-9]{0,18}$'
    OR p_acknowledged IS NULL OR p_acknowledged !~ '^(0|[1-9][0-9]{0,18})$'
  THEN RAISE EXCEPTION 'Invalid activity device sequence'; END IF;

  seq := p_sequence::bigint;
  ack := p_acknowledged::bigint;
  IF ack >= seq THEN RAISE EXCEPTION 'Invalid activity acknowledgement'; END IF;

  INSERT INTO catho_private.activity_devices(user_id, device_id)
  VALUES (actor, p_device) ON CONFLICT DO NOTHING;

  SELECT * INTO state FROM catho_private.activity_devices
  WHERE user_id = actor AND device_id = p_device FOR UPDATE;

  IF seq <= state.acknowledged_sequence THEN
    RAISE EXCEPTION 'Activity operation was already acknowledged';
  END IF;
  IF ack > state.last_sequence THEN RAISE EXCEPTION 'Unknown activity acknowledgement'; END IF;
  IF ack > state.acknowledged_sequence AND NOT EXISTS (
    SELECT 1 FROM catho_private.activity_receipt_sequences
    WHERE user_id = actor AND device_id = p_device AND sequence = ack
  ) THEN RAISE EXCEPTION 'Unknown activity acknowledgement'; END IF;

  SELECT operation_id INTO mapped FROM catho_private.activity_receipt_sequences
  WHERE user_id = actor AND device_id = p_device AND sequence = seq;

  IF (FOUND AND mapped IS DISTINCT FROM p_operation)
    OR (NOT FOUND AND seq <= state.last_sequence) THEN
    RAISE EXCEPTION 'Activity device sequence was reused';
  END IF;
  IF mapped IS NULL AND ack < state.last_sequence AND seq <> state.last_sequence + 1 THEN
    RAISE EXCEPTION 'Previous activity operation was not acknowledged';
  END IF;
  IF mapped IS NULL AND EXISTS (
    SELECT 1 FROM catho_private.activity_receipt_sequences
    WHERE user_id = actor AND operation_id = p_operation
  ) THEN RAISE EXCEPTION 'Activity operation ID was reused'; END IF;

  -- Count only new operations. Replaying a committed receipt after a lost
  -- response must remain idempotent and must not consume the write allowance.
  IF mapped IS NULL THEN
    INSERT INTO catho_private.user_action_limits(user_id)
    VALUES(actor) ON CONFLICT(user_id) DO NOTHING;

    UPDATE catho_private.user_action_limits
    SET
      offline_sync_count = CASE
        WHEN offline_sync_window_started_at IS NULL
          OR offline_sync_window_started_at <= now_at - interval '1 minute' THEN 1
        ELSE LEAST(offline_sync_count + 1, 301)
      END,
      offline_sync_window_started_at = CASE
        WHEN offline_sync_window_started_at IS NULL
          OR offline_sync_window_started_at <= now_at - interval '1 minute' THEN now_at
        ELSE offline_sync_window_started_at
      END
    WHERE user_id = actor
    RETURNING offline_sync_count INTO sync_count;

    IF sync_count > 300 THEN
      RAISE EXCEPTION 'Offline activity sync rate limit exceeded' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF ack > state.acknowledged_sequence THEN
    DELETE FROM catho_private.activity_receipts r
    USING catho_private.activity_receipt_sequences s
    WHERE s.user_id = actor AND s.device_id = p_device AND s.sequence <= ack
      AND r.user_id = s.user_id AND r.operation_id = s.operation_id;

    UPDATE catho_private.activity_devices
    SET acknowledged_sequence = ack
    WHERE user_id = actor AND device_id = p_device;
  END IF;

  DELETE FROM catho_private.activity_receipt_sequences
  WHERE user_id = actor AND device_id = p_device AND sequence <= ack;

  result := public.offline_apply_activity(
    p_user, p_operation, p_kind, p_topic, p_value, p_completed_at
  );

  IF mapped IS NULL THEN
    INSERT INTO catho_private.activity_receipt_sequences(
      user_id, device_id, sequence, operation_id
    ) VALUES (actor, p_device, seq, p_operation);

    UPDATE catho_private.activity_devices
    SET last_sequence = seq
    WHERE user_id = actor AND device_id = p_device;
  END IF;

  RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_category_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_published THEN PERFORM public.offline_catalogue_record('category', NEW.slug); END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_published THEN PERFORM public.offline_catalogue_record('reset', 'category'); END IF;
  ELSIF OLD.slug IS DISTINCT FROM NEW.slug OR OLD.is_published IS DISTINCT FROM NEW.is_published THEN
    PERFORM public.offline_catalogue_record('reset', 'category');
  ELSIF NEW.is_published THEN
    PERFORM public.offline_catalogue_record('category', NEW.slug);
  END IF;
  RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_changes(p_after text, p_through text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE after_revision bigint; through_revision bigint; head bigint; floor bigint;
  entries jsonb; last_revision bigint; needs_reset boolean;
BEGIN
  IF p_after IS NULL OR p_after !~ '^(0|[1-9][0-9]{0,18})$'
    OR p_through IS NULL OR p_through !~ '^(0|[1-9][0-9]{0,18})$'
  THEN RAISE EXCEPTION 'Invalid catalogue revision'; END IF;
  after_revision := p_after::bigint;
  through_revision := p_through::bigint;
  SELECT revision, floor_revision INTO head, floor FROM public.offline_catalogue_revision WHERE singleton;
  IF NOT FOUND OR after_revision > through_revision OR through_revision > head THEN
    RAISE EXCEPTION 'Invalid catalogue revision range';
  END IF;
  IF after_revision < floor THEN
    RETURN jsonb_build_object('changes', '[]'::jsonb, 'hasMore', false, 'resetRequired', true);
  END IF;
  WITH page AS (
    SELECT revision, kind, entity_key FROM public.offline_catalogue_events
    WHERE revision > after_revision AND revision <= through_revision ORDER BY revision LIMIT 100
  ), values AS (
    SELECT p.*, CASE p.kind
      WHEN 'category' THEN (
        SELECT jsonb_build_object('slug', c.slug, 'name', c.name, 'description', c.description, 'orderIndex', c.order_index)
        FROM public.categories c WHERE c.slug = p.entity_key AND c.is_published
      )
      WHEN 'topic' THEN (
        SELECT jsonb_build_object(
          'id', t.id, 'slug', t.slug, 'categorySlug', t.category_slug, 'orderIndex', t.order_index,
          'question', t.question, 'answer', t.answer, 'explanation', t.explanation,
          'catechismParagraphs', coalesce(t.catechism_paragraphs, ARRAY[]::text[]),
          'catechismText', t.catechism_text, 'scriptureReference', t.scripture_reference, 'scriptureText', t.scripture_text
        )
        FROM public.topics t JOIN public.categories c ON c.slug = t.category_slug
        WHERE t.id = p.entity_key AND t.is_published AND c.is_published
      )
      ELSE NULL END AS payload
    FROM page p
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision', revision::text,
      'kind', kind, 'key', entity_key, 'value', payload) ORDER BY revision), '[]'::jsonb),
    max(revision), coalesce(bool_or(kind = 'reset' OR (kind = 'category' AND payload IS NULL)), false)
  INTO entries, last_revision, needs_reset FROM values;
  IF needs_reset THEN
    RETURN jsonb_build_object('changes', '[]'::jsonb, 'hasMore', false, 'resetRequired', true);
  END IF;
  RETURN jsonb_build_object('changes', entries, 'hasMore', coalesce(last_revision < through_revision, false),
    'resetRequired', false);
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'revision', revision::text,
    'categories', (SELECT count(*)::text FROM public.categories c WHERE c.is_published),
    'topics', (
      SELECT count(*)::text FROM public.topics t
      JOIN public.categories c ON c.slug = t.category_slug
      WHERE t.is_published AND c.is_published
    )
  )
  FROM public.offline_catalogue_revision WHERE singleton
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_head()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('revision', revision::text)
  FROM public.offline_catalogue_revision WHERE singleton
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(1128350799, 1128350802);
  RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_prune(p_through bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE current_head bigint; current_floor bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(1128350799, 1128350802);
  SELECT revision, floor_revision INTO current_head, current_floor
  FROM public.offline_catalogue_revision WHERE singleton FOR UPDATE;
  IF NOT FOUND OR p_through IS NULL OR p_through < current_floor OR p_through > current_head THEN
    RAISE EXCEPTION 'Invalid catalogue retention boundary';
  END IF;
  DELETE FROM public.offline_catalogue_events WHERE revision <= p_through;
  UPDATE public.offline_catalogue_revision SET floor_revision = p_through WHERE singleton;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_prune_old(p_before timestamp with time zone, p_limit integer DEFAULT 1000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE current_head bigint; current_floor bigint; first_revision bigint;
  last_revision bigint; row_count bigint;
BEGIN
  IF p_before IS NULL OR p_before > clock_timestamp() - interval '30 days'
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Invalid catalogue retention parameters';
  END IF;
  PERFORM pg_advisory_xact_lock(1128350799, 1128350802);
  SELECT revision, floor_revision INTO current_head, current_floor
  FROM public.offline_catalogue_revision WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing catalogue revision'; END IF;
  WITH candidates AS (
    SELECT revision, created_at FROM public.offline_catalogue_events
    WHERE revision > current_floor ORDER BY revision LIMIT p_limit
  ), bounded AS (
    SELECT revision, min(revision) FILTER (WHERE created_at > p_before) OVER () AS first_recent
    FROM candidates
  )
  SELECT min(revision), max(revision), count(*) INTO first_revision, last_revision, row_count
  FROM bounded WHERE first_recent IS NULL OR revision < first_recent;
  IF row_count = 0 THEN RETURN 0; END IF;
  IF first_revision <> current_floor + 1 OR last_revision > current_head
    OR row_count <> last_revision - current_floor THEN
    RAISE EXCEPTION 'Catalogue history is incomplete';
  END IF;
  DELETE FROM public.offline_catalogue_events WHERE revision <= last_revision;
  UPDATE public.offline_catalogue_revision SET floor_revision = last_revision WHERE singleton;
  RETURN row_count::integer;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_record(p_kind text, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE next_revision bigint;
BEGIN
  UPDATE public.offline_catalogue_revision SET revision = revision + 1
  WHERE singleton RETURNING revision INTO next_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing catalogue revision'; END IF;
  INSERT INTO public.offline_catalogue_events(revision, kind, entity_key)
  VALUES (next_revision, p_kind, p_key);
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_topic_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE was_visible boolean := false; is_visible boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT OLD.is_published AND coalesce(c.is_published, false) INTO was_visible
    FROM (SELECT 1) x LEFT JOIN public.categories c ON c.slug = OLD.category_slug;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT NEW.is_published AND coalesce(c.is_published, false) INTO is_visible
    FROM (SELECT 1) x LEFT JOIN public.categories c ON c.slug = NEW.category_slug;
  END IF;
  IF was_visible AND (NOT is_visible OR (TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id)) THEN
    PERFORM public.offline_catalogue_record('topic', OLD.id);
  END IF;
  IF is_visible THEN PERFORM public.offline_catalogue_record('topic', NEW.id); END IF;
  RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION public.offline_catalogue_truncated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.offline_catalogue_record('reset', 'truncate');
  RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION public.reject_comment_edit_from_banned_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  request_user_id uuid := auth.uid();
BEGIN
  IF request_user_id IS NULL OR NEW.user_id IS DISTINCT FROM request_user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_comment_bans
    WHERE user_id = request_user_id
      AND unbanned_at IS NULL
  ) AND (
    NEW.content IS DISTINCT FROM OLD.content
    OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
    OR (OLD.is_deleted AND NOT NEW.is_deleted)
  ) THEN
    RAISE EXCEPTION 'Editing comments is restricted for this account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.reject_comment_from_banned_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  request_user_id uuid := auth.uid();
BEGIN
  IF request_user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM request_user_id THEN
    RAISE EXCEPTION 'Cannot create a comment for another user'
      USING ERRCODE = '42501';
  END IF;

  IF request_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_comment_bans
    WHERE user_id = request_user_id
      AND unbanned_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Posting comments is restricted for this account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$

CREATE OR REPLACE FUNCTION public.search_published_topics(search_query text, result_limit integer DEFAULT 30)
 RETURNS TABLE(id text, slug text, category_slug text, category_name text, question text, answer text, explanation text, catechism_paragraphs text[], catechism_text text, scripture_reference text, scripture_text text, search_score real)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH parsed_query AS (
    SELECT websearch_to_tsquery('english', coalesce(search_query, '')) AS query
  ),
  matching_topic_ids AS (
    SELECT topic.id
    FROM public.topics AS topic
    CROSS JOIN parsed_query
    WHERE topic.is_published = true
      AND numnode(parsed_query.query) > 0
      AND topic.search_vector @@ parsed_query.query
    UNION
    SELECT topic.id
    FROM public.categories AS category
    INNER JOIN public.topics AS topic ON topic.category_slug = category.slug
    CROSS JOIN parsed_query
    WHERE topic.is_published = true
      AND category.is_published = true
      AND numnode(parsed_query.query) > 0
      AND to_tsvector('english', coalesce(category.name, '')) @@ parsed_query.query
  ),
  ranked_topics AS (
    SELECT
      topic.id, topic.slug, category.slug AS category_slug, category.name AS category_name,
      topic.question, topic.answer, topic.explanation, topic.catechism_paragraphs,
      topic.catechism_text, topic.scripture_reference, topic.scripture_text,
      (
        ts_rank(topic.search_vector, parsed_query.query) +
        CASE
          WHEN to_tsvector('english', coalesce(category.name, '')) @@ parsed_query.query
          THEN 0.5 * ts_rank(to_tsvector('english', coalesce(category.name, '')), parsed_query.query)
          ELSE 0
        END
      )::real AS search_score
    FROM matching_topic_ids AS matched
    INNER JOIN public.topics AS topic ON topic.id = matched.id
    INNER JOIN public.categories AS category ON category.slug = topic.category_slug
    CROSS JOIN parsed_query
    WHERE topic.is_published = true AND category.is_published = true
  )
  SELECT
    ranked_topics.id, ranked_topics.slug, ranked_topics.category_slug, ranked_topics.category_name,
    ranked_topics.question, ranked_topics.answer, ranked_topics.explanation, ranked_topics.catechism_paragraphs,
    ranked_topics.catechism_text, ranked_topics.scripture_reference, ranked_topics.scripture_text, ranked_topics.search_score
  FROM ranked_topics
  ORDER BY ranked_topics.search_score DESC, ranked_topics.question ASC, ranked_topics.id ASC
  LIMIT least(greatest(coalesce(result_limit, 30), 1), 50);
$function$

CREATE OR REPLACE FUNCTION public.set_content_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.submit_comment_report(reporter_user_id uuid, target_comment_id bigint, report_reason text, report_details text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  comment_owner_id uuid;
  comment_is_deleted boolean;
  recent_report_count integer;
BEGIN
  IF reporter_user_id IS NULL
     OR target_comment_id IS NULL
     OR report_reason IS NULL
     OR report_reason NOT IN ('harassment', 'hate_speech', 'spam', 'inappropriate', 'other')
     OR (report_details IS NOT NULL AND char_length(report_details) > 1000) THEN
    RAISE EXCEPTION 'Invalid report details' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(reporter_user_id::text, 0));

  SELECT user_id, is_deleted
  INTO comment_owner_id, comment_is_deleted
  FROM public.comments
  WHERE id = target_comment_id;

  IF NOT FOUND OR comment_is_deleted THEN
    RAISE EXCEPTION 'Comment not found' USING ERRCODE = 'P0002';
  END IF;

  IF comment_owner_id = reporter_user_id THEN
    RAISE EXCEPTION 'Cannot report your own comment' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO recent_report_count
  FROM public.comment_reports
  WHERE reporter_id = reporter_user_id
    AND created_at >= now() - interval '24 hours';

  IF recent_report_count >= 10 THEN
    RAISE EXCEPTION 'Report limit reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.comment_reports (reporter_id, comment_id, reason, details)
  VALUES (
    reporter_user_id,
    target_comment_id,
    report_reason,
    NULLIF(btrim(report_details), '')
  );
END;
$function$


RESET check_function_bodies;

-- Application triggers
CREATE TRIGGER admin_action_audit_no_update BEFORE DELETE OR UPDATE ON catho_private.admin_action_audit FOR EACH ROW EXECUTE FUNCTION catho_private.prevent_audit_mutation();
CREATE TRIGGER bookmarks_enforce_activity_rate_limit BEFORE INSERT OR DELETE ON bookmarks FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_activity_mutation_rate_limit();
CREATE TRIGGER cathoscroll_activity_sync AFTER INSERT OR DELETE OR UPDATE ON bookmarks FOR EACH ROW EXECUTE FUNCTION catho_private.activity_changed();
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_content_updated_at();
CREATE TRIGGER offline_catalogue_categories_changed AFTER INSERT OR DELETE OR UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION offline_catalogue_category_changed();
CREATE TRIGGER offline_catalogue_categories_lock BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON categories FOR EACH STATEMENT EXECUTE FUNCTION offline_catalogue_lock();
CREATE TRIGGER offline_catalogue_categories_truncated AFTER TRUNCATE ON categories FOR EACH STATEMENT EXECUTE FUNCTION offline_catalogue_truncated();
CREATE TRIGGER audit_comment_appeal_reviews AFTER UPDATE ON comment_ban_appeals FOR EACH ROW EXECUTE FUNCTION catho_private.audit_moderation_change();
CREATE TRIGGER comment_appeal_reviewed_notification AFTER UPDATE OF status ON comment_ban_appeals FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION notify_comment_appeal_reviewed();
CREATE TRIGGER comment_ban_appeals_enforce_user_rate_limit BEFORE INSERT ON comment_ban_appeals FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();
CREATE TRIGGER comment_likes_enforce_user_rate_limit BEFORE INSERT ON comment_likes FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();
CREATE TRIGGER audit_comment_report_reviews AFTER UPDATE ON comment_reports FOR EACH ROW EXECUTE FUNCTION catho_private.audit_moderation_change();
CREATE TRIGGER comment_report_reviewed_notification AFTER UPDATE OF status ON comment_reports FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION notify_comment_report_reviewed();
CREATE TRIGGER comment_pin_notification AFTER UPDATE OF is_pinned ON comments FOR EACH ROW EXECUTE FUNCTION notify_comment_pin_change();
CREATE TRIGGER comment_reply_notification AFTER INSERT ON comments FOR EACH ROW EXECUTE FUNCTION notify_comment_reply();
CREATE TRIGGER comments_enforce_user_rate_limit BEFORE INSERT OR UPDATE OF content ON comments FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();
CREATE TRIGGER comments_validate_write BEFORE INSERT OR UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION catho_private.validate_comment_write();
CREATE TRIGGER moderated_comment_visibility_notification AFTER UPDATE ON comments REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_moderated_comment_visibility();
CREATE TRIGGER reject_banned_comment_edit BEFORE UPDATE OF content, edited_at, is_deleted ON comments FOR EACH ROW EXECUTE FUNCTION reject_comment_edit_from_banned_user();
CREATE TRIGGER reject_banned_comment_insert BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION reject_comment_from_banned_user();
CREATE TRIGGER notifications_validate_read_update BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION catho_private.validate_notification_read_update();
CREATE TRIGGER profile_created_notification AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION notify_profile_created();
CREATE TRIGGER cathoscroll_activity_sync AFTER INSERT OR DELETE OR UPDATE ON progress FOR EACH ROW EXECUTE FUNCTION catho_private.activity_changed();
CREATE TRIGGER progress_enforce_activity_rate_limit BEFORE INSERT OR DELETE OR UPDATE ON progress FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_activity_mutation_rate_limit();
CREATE TRIGGER cathoscroll_activity_sync AFTER INSERT OR DELETE OR UPDATE ON topic_likes FOR EACH ROW EXECUTE FUNCTION catho_private.activity_changed();
CREATE TRIGGER topic_likes_enforce_user_rate_limit BEFORE INSERT ON topic_likes FOR EACH ROW EXECUTE FUNCTION catho_private.enforce_user_action_rate_limit();
CREATE TRIGGER offline_catalogue_topics_changed AFTER INSERT OR DELETE OR UPDATE ON topics FOR EACH ROW EXECUTE FUNCTION offline_catalogue_topic_changed();
CREATE TRIGGER offline_catalogue_topics_lock BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON topics FOR EACH STATEMENT EXECUTE FUNCTION offline_catalogue_lock();
CREATE TRIGGER offline_catalogue_topics_truncated AFTER TRUNCATE ON topics FOR EACH STATEMENT EXECUTE FUNCTION offline_catalogue_truncated();
CREATE TRIGGER topics_set_updated_at BEFORE UPDATE ON topics FOR EACH ROW EXECUTE FUNCTION set_content_updated_at();
CREATE TRIGGER audit_comment_ban_changes AFTER INSERT OR UPDATE ON user_comment_bans FOR EACH ROW EXECUTE FUNCTION catho_private.audit_moderation_change();
CREATE TRIGGER comment_restriction_created_notification AFTER INSERT ON user_comment_bans FOR EACH ROW EXECUTE FUNCTION notify_comment_restriction_created();
CREATE TRIGGER comment_restriction_lifted_notification AFTER UPDATE OF unbanned_at ON user_comment_bans FOR EACH ROW EXECUTE FUNCTION notify_comment_restriction_lifted();

-- Enable row-level security
ALTER TABLE catho_private.activity_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.activity_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.activity_receipt_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.activity_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.admin_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.admin_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.security_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.user_action_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_ban_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_catalogue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_catalogue_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_comment_ban_hidden_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_comment_bans ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY admin_users_select_self ON public.admin_users AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can create own bookmarks" ON public.bookmarks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete own bookmarks" ON public.bookmarks AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own bookmarks" ON public.bookmarks AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY categories_public_or_admin_read_authenticated ON public.categories AS PERMISSIVE FOR SELECT TO authenticated USING ((is_published OR is_cathoscroll_content_admin()));
CREATE POLICY categories_public_read_anon ON public.categories AS PERMISSIVE FOR SELECT TO anon USING (is_published);
CREATE POLICY comment_ban_appeals_select_self ON public.comment_ban_appeals AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can create comment likes" ON public.comment_likes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete own comment likes" ON public.comment_likes AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY comment_likes_select_own ON public.comment_likes AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Anyone can view comments" ON public.comments AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Users can create comments" ON public.comments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own comments" ON public.comments AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can create own notes" ON public.notes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete own notes" ON public.notes AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own notes" ON public.notes AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own notes" ON public.notes AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can mark their own notifications as read" ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) AND (read_at IS NULL))) WITH CHECK (((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id) AND (read_at IS NOT NULL)));
CREATE POLICY "Users can read their own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT ( SELECT auth.uid() AS uid) AS uid) = user_id));
CREATE POLICY "Public can view profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "Users can create own progress" ON public.progress AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete own progress" ON public.progress AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can update own progress" ON public.progress AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own progress" ON public.progress AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can create likes" ON public.topic_likes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can delete likes" ON public.topic_likes AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY topic_likes_select_own ON public.topic_likes AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY topics_public_or_admin_read_authenticated ON public.topics AS PERMISSIVE FOR SELECT TO authenticated USING ((is_cathoscroll_content_admin() OR (is_published AND (EXISTS ( SELECT 1
   FROM categories category
  WHERE ((category.slug = topics.category_slug) AND (category.is_published = true)))))));
CREATE POLICY topics_public_read_anon ON public.topics AS PERMISSIVE FOR SELECT TO anon USING ((is_published AND (EXISTS ( SELECT 1
   FROM categories category
  WHERE ((category.slug = topics.category_slug) AND (category.is_published = true))))));
CREATE POLICY user_comment_bans_select_self ON public.user_comment_bans AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

-- Schema grants
GRANT USAGE ON SCHEMA catho_private TO anon;
GRANT USAGE ON SCHEMA catho_private TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO PUBLIC;

-- Table grants
GRANT SELECT ON TABLE public.admin_users TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.admin_users TO service_role;
GRANT MAINTAIN ON TABLE public.bookmarks TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT ON TABLE public.bookmarks TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bookmarks TO service_role;
GRANT SELECT ON TABLE public.categories TO anon;
GRANT SELECT ON TABLE public.categories TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.categories TO service_role;
GRANT SELECT ON TABLE public.comment_ban_appeals TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_ban_appeals TO service_role;
GRANT MAINTAIN ON TABLE public.comment_likes TO anon;
GRANT DELETE, INSERT, MAINTAIN ON TABLE public.comment_likes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_likes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comment_reports TO service_role;
GRANT MAINTAIN ON TABLE public.comments TO anon;
GRANT MAINTAIN ON TABLE public.comments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.comments TO service_role;
GRANT MAINTAIN ON TABLE public.notes TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE public.notes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notes TO service_role;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.offline_catalogue_events TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.offline_catalogue_revision TO service_role;
GRANT MAINTAIN ON TABLE public.profiles TO anon;
GRANT MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profiles TO service_role;
GRANT MAINTAIN ON TABLE public.progress TO anon;
GRANT DELETE, INSERT, MAINTAIN, SELECT, UPDATE ON TABLE public.progress TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.progress TO service_role;
GRANT MAINTAIN ON TABLE public.topic_likes TO anon;
GRANT DELETE, INSERT, MAINTAIN ON TABLE public.topic_likes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.topic_likes TO service_role;
GRANT SELECT ON TABLE public.topics TO anon;
GRANT SELECT ON TABLE public.topics TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.topics TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_comment_ban_hidden_comments TO service_role;
GRANT SELECT ON TABLE public.user_comment_bans TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_comment_bans TO service_role;

-- Sequence grants, including identity sequences
GRANT SELECT ON SEQUENCE public.bookmarks_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.bookmarks_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.bookmarks_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.bookmarks_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.bookmarks_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.bookmarks_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.bookmarks_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.bookmarks_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.bookmarks_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.comment_ban_appeals_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.comment_ban_appeals_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.comment_ban_appeals_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.comment_ban_appeals_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.comment_ban_appeals_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.comment_ban_appeals_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.comment_ban_appeals_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.comment_ban_appeals_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.comment_ban_appeals_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.comment_likes_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.comment_likes_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.comment_likes_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.comment_likes_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.comment_likes_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.comment_likes_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.comment_likes_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.comment_likes_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.comment_likes_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.comment_reports_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.comment_reports_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.comment_reports_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.comment_reports_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.comment_reports_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.comment_reports_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.comment_reports_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.comment_reports_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.comment_reports_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.comments_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.comments_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.comments_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.comments_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.comments_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.comments_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.comments_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.comments_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.comments_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.notes_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.notes_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.notes_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.notes_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.notes_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.notes_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.notes_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.notes_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.notes_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.notifications_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.notifications_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.notifications_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.notifications_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.notifications_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.notifications_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.progress_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.progress_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.progress_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.progress_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.progress_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.progress_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.progress_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.progress_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.progress_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.topic_likes_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.topic_likes_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.topic_likes_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.topic_likes_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.topic_likes_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.topic_likes_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.topic_likes_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.topic_likes_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.topic_likes_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.user_comment_bans_id_seq TO anon;
GRANT UPDATE ON SEQUENCE public.user_comment_bans_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.user_comment_bans_id_seq TO anon;
GRANT SELECT ON SEQUENCE public.user_comment_bans_id_seq TO authenticated;
GRANT UPDATE ON SEQUENCE public.user_comment_bans_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.user_comment_bans_id_seq TO authenticated;
GRANT SELECT ON SEQUENCE public.user_comment_bans_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.user_comment_bans_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.user_comment_bans_id_seq TO service_role;

-- Function grants: reset default access then restore exact source ACL
REVOKE ALL ON FUNCTION catho_private.activity_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.audit_moderation_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.consume_recommendation_rate_limit(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.enforce_activity_mutation_rate_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.enforce_user_action_rate_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.is_cathoscroll_content_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prevent_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_activity(p_user uuid, p_through bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_due_activity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.prune_old_activity(p_user uuid, p_before timestamp with time zone, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.record_activity(p_user uuid, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.validate_comment_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catho_private.validate_notification_read_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_action_audit(p_actor_user_id uuid, p_before_id bigint, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_manage_comment_ban(target_user_id uuid, moderator_user_id uuid, moderation_action text, moderation_reason text, hide_existing_comments boolean, restore_hidden_comments boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_mfa_enforcement_enabled() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_review_comment_ban_appeal(target_appeal_id bigint, approve_appeal boolean, reviewer_user_id uuid, review_note text, restore_hidden_comments boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_review_comment_report(target_report_id bigint, review_action text, reviewer_user_id uuid, review_note text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_comment_pin(target_comment_id bigint, should_pin boolean, moderator_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_actor_user_id uuid, p_grant boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_user_has_verified_totp(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(p_key_hash text, p_limit integer, p_window_seconds integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enable_admin_mfa_enforcement(p_actor_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_recommendation_page(feed_cursor jsonb, page_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_topic_engagement() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_own_subscription_tier() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_profile_metrics(p_profile_id uuid, p_timezone text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_topic_comment_page(p_topic_id text, p_before_created_at timestamp with time zone, p_before_id bigint, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_topic_like_state(p_topic_id text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_cathoscroll_admin_owner(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_cathoscroll_content_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_appeal_reviewed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_pin_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_reply() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_report_reviewed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_restriction_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_comment_restriction_lifted() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_moderated_comment_visibility() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_profile_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_activity_changes(p_user uuid, p_after text, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_activity_head(p_user uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_activity_snapshot(p_user uuid, p_cursor text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_apply_activity(p_user uuid, p_operation uuid, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_apply_activity_batch(p_user uuid, p_operations jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_apply_activity_v2(p_user uuid, p_operation uuid, p_device uuid, p_sequence text, p_acknowledged text, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_category_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_changes(p_after text, p_through text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_counts() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_head() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_lock() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_prune(p_through bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_prune_old(p_before timestamp with time zone, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_record(p_kind text, p_key text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_topic_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.offline_catalogue_truncated() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_comment_edit_from_banned_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_comment_from_banned_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_published_topics(search_query text, result_limit integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_content_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_comment_report(reporter_user_id uuid, target_comment_id bigint, report_reason text, report_details text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.consume_recommendation_rate_limit(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION catho_private.is_cathoscroll_content_admin() TO anon;
GRANT EXECUTE ON FUNCTION catho_private.is_cathoscroll_content_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION catho_private.validate_notification_read_update() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_action_audit(p_actor_user_id uuid, p_before_id bigint, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_manage_comment_ban(target_user_id uuid, moderator_user_id uuid, moderation_action text, moderation_reason text, hide_existing_comments boolean, restore_hidden_comments boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_mfa_enforcement_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_comment_ban_appeal(target_appeal_id bigint, approve_appeal boolean, reviewer_user_id uuid, review_note text, restore_hidden_comments boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_comment_report(target_report_id bigint, review_action text, reviewer_user_id uuid, review_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_comment_pin(target_comment_id bigint, should_pin boolean, moderator_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_actor_user_id uuid, p_grant boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_has_verified_totp(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(p_key_hash text, p_limit integer, p_window_seconds integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enable_admin_mfa_enforcement(p_actor_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(feed_cursor jsonb, page_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(feed_cursor jsonb, page_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_topic_engagement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_topic_engagement() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_own_subscription_tier() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile_metrics(p_profile_id uuid, p_timezone text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_metrics(p_profile_id uuid, p_timezone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_topic_comment_page(p_topic_id text, p_before_created_at timestamp with time zone, p_before_id bigint, p_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_topic_comment_page(p_topic_id text, p_before_created_at timestamp with time zone, p_before_id bigint, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_topic_like_state(p_topic_id text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_topic_like_state(p_topic_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_admin_owner(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_content_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_cathoscroll_content_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_changes(p_user uuid, p_after text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_changes(p_user uuid, p_after text, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_activity_head(p_user uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_head(p_user uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_activity_snapshot(p_user uuid, p_cursor text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_activity_snapshot(p_user uuid, p_cursor text) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity(p_user uuid, p_operation uuid, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_batch(p_user uuid, p_operations jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_v2(p_user uuid, p_operation uuid, p_device uuid, p_sequence text, p_acknowledged text, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_v2(p_user uuid, p_operation uuid, p_device uuid, p_sequence text, p_acknowledged text, p_kind text, p_topic text, p_value boolean, p_completed_at timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(p_after text, p_through text) TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(p_after text, p_through text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_changes(p_after text, p_through text) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO anon;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO authenticated;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_head() TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_prune(p_through bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_prune_old(p_before timestamp with time zone, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.offline_catalogue_record(p_kind text, p_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_published_topics(search_query text, result_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_published_topics(search_query text, result_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_content_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_comment_report(reporter_user_id uuid, target_comment_id bigint, report_reason text, report_details text) TO service_role;

-- Preserve the source project's service_role defaults for future objects.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

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
END;
$cron_restore$;

NOTIFY pgrst, 'reload schema';
-- End of CathoScroll application-schema bootstrap.