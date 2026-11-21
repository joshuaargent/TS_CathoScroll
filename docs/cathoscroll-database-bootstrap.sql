-- CathoScroll complete application-schema and public catalogue bootstrap
-- Reconciled against production on 2026-11-20.
--
-- IMPORTANT:
--   * Run ONLY against a fresh Supabase project. This script intentionally
--     stops if CathoScroll application tables already exist.
--   * Recreates CathoScroll-owned schema objects and seeds the public category
--     and topic catalogue plus required singleton control/revision rows.
--   * Does NOT restore Auth users/passwords, profiles, admin assignments,
--     bookmarks, comments, notes, notifications, moderation history, other
--     user-generated rows, Storage objects, secrets, project settings,
--     Edge Functions, or Supabase-managed platform internals. Back those up
--     separately if they are needed.
--   * Target must have standard Supabase roles and auth.users, and should use
--     the same PostgreSQL major version as the source project.
--   * pg_cron and permission to create the ensure_rls event trigger are required.
--
-- Production inventory (2026-11-20): 53 tables, 106 unique functions,
-- 34 application/Auth triggers, 32 policies, 95 explicit indexes,
-- 15 categories and 86 topics. Constraint-backed indexes are additional.
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
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
CREATE SCHEMA IF NOT EXISTS catho_private;
-- Purpose-specific optional analytics consent. Defaults are deliberately off.
CREATE TABLE IF NOT EXISTS catho_private.user_analytics_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  service_improvement boolean NOT NULL DEFAULT false,
  sponsor_measurement boolean NOT NULL DEFAULT false,
  consent_version integer NOT NULL DEFAULT 2 CHECK (consent_version >= 1),
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

-- Restore the current public catalogue and required singleton rows before
-- application triggers are installed, so bootstrap inserts do not emit
-- synthetic catalogue/activity events or moderation notifications.
INSERT INTO public.categories (slug, name, description, order_index, is_published, created_at, updated_at)
SELECT x.slug, x.name, x.description, x.order_index, x.is_published, x.created_at, x.updated_at
FROM jsonb_populate_recordset(NULL::public.categories, $cathoscroll_categories$[{"name":"God","slug":"god","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Who God is and what He has revealed about Himself.","order_index":0,"is_published":true},{"name":"Jesus Christ","slug":"jesus-christ","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The life, mission, death and resurrection of Christ.","order_index":1,"is_published":true},{"name":"The Church","slug":"the-church","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The Catholic Church, its authority and mission.","order_index":2,"is_published":true},{"name":"Scripture","slug":"scripture","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The Bible and God’s revelation through Sacred Scripture.","order_index":3,"is_published":true},{"name":"Prayer","slug":"prayer","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Growing closer to God through prayer.","order_index":4,"is_published":true},{"name":"The Sacraments","slug":"the-sacraments","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The seven sacraments and the life of grace.","order_index":5,"is_published":true},{"name":"Mary & Saints","slug":"mary-saints","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The Blessed Virgin Mary and the communion of saints.","order_index":6,"is_published":true},{"name":"Salvation","slug":"salvation","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"How Christ saves humanity and brings eternal life.","order_index":7,"is_published":true},{"name":"Sin & Grace","slug":"sin-grace","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Sin, forgiveness and life in God’s grace.","order_index":8,"is_published":true},{"name":"Moral Life","slug":"moral-life","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Living according to God’s commandments.","order_index":9,"is_published":true},{"name":"Marriage & Family","slug":"marriage-family","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Catholic teaching on marriage and family life.","order_index":10,"is_published":true},{"name":"Life Issues","slug":"life-issues","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Human dignity from conception to natural death.","order_index":11,"is_published":true},{"name":"Heaven, Hell & Purgatory","slug":"heaven-hell-purgatory","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Death, judgement and eternal destiny.","order_index":12,"is_published":true},{"name":"Apologetics","slug":"apologetics","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"Defending and explaining the Catholic faith.","order_index":13,"is_published":true},{"name":"Science & Faith","slug":"science-faith","created_at":"2026-11-10T09:59:47.485201+00:00","updated_at":"2026-11-10T09:59:47.485201+00:00","description":"The relationship between Catholicism and science.","order_index":14,"is_published":true}]$cathoscroll_categories$::jsonb) AS x;

INSERT INTO public.topics (id, slug, category_slug, order_index, question, answer, explanation, catechism_paragraphs, catechism_text, scripture_reference, scripture_text, is_published, created_at, updated_at)
SELECT x.id, x.slug, x.category_slug, x.order_index, x.question, x.answer, x.explanation, x.catechism_paragraphs, x.catechism_text, x.scripture_reference, x.scripture_text, x.is_published, x.created_at, x.updated_at
FROM jsonb_populate_recordset(NULL::public.topics, $cathoscroll_topics$[{"id":"1","slug":"who-made-you","answer":"God made me.","question":"Who made you?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"This simple answer teaches one of the most important truths of the Catholic faith: we are not accidents. Every human person exists because God freely chose to create them. God knows each person, loves each person, and wills their existence. Because we are created by God, every human life possesses inherent dignity and value that cannot be taken away by success, failure, wealth, ability, or social status. Understanding that God made us helps us understand who we are and why we are here. We belong to God, depend upon Him for everything, and are called to live in a relationship with Him. Recognising God as our Creator should lead us to gratitude, humility, worship, and trust in His loving plan for our lives.","order_index":0,"is_published":true,"category_slug":"god","catechism_text":"God created the world according to his wisdom and love. God created man in his own image, in the image of God he created him; male and female he created them. Of all visible creatures only man is able to know and love his creator.","scripture_text":"So God created man in his own image, in the image of God he created him; male and female he created them.","scripture_reference":"Genesis 1:27","catechism_paragraphs":["1","295","355"]},{"id":"2","slug":"why-did-god-make-you","answer":"God made me to know him, love him and serve him in this world, and to be happy with him for ever in the next.","question":"Why did God make you?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"This answer summarises the purpose of human life. God did not create us without purpose or direction. He created us so that we might enter into a relationship with Him. We come to know God through faith, prayer, Scripture, and the teaching of the Church. We show our love for God through worship, obedience, and charity towards others. We serve God by living according to His commandments and using our gifts for His glory. Earthly life is therefore a preparation for eternal life. While many people search for happiness in possessions, achievements, or pleasure, the deepest fulfilment of the human heart is found only in God. The goal of the Christian life is not merely to be a good person but to share forever in the life and happiness of God in Heaven.","order_index":1,"is_published":true,"category_slug":"god","catechism_text":"God, infinitely perfect and blessed in himself, freely created man to make him share in his own blessed life. The desire for God is written in the human heart because man is created by God and for God. God put us in the world to know, to love, and to serve him, and so to come to paradise.","scripture_text":"And this is eternal life, that they know you the only true God, and Jesus Christ whom you have sent.","scripture_reference":"John 17:3","catechism_paragraphs":["1","27","1721"]},{"id":"3","slug":"image-and-likeness-of-god","answer":"God made me to his own image and likeness.","question":"To whose image and likeness did God make you?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Being made in the image and likeness of God gives every human person a unique dignity. Unlike animals and the rest of creation, human beings are capable of reason, free choice, love, and relationship with God. The image of God is present in every person from conception until natural death and is the foundation of human dignity. Although sin wounded humanity, it did not destroy this image. Through Jesus Christ, we are called not only to reflect God more clearly in this life but also to be transformed by grace and ultimately share in His glory. The Church therefore teaches that every human person deserves respect and protection because each person bears the image of their Creator.","order_index":2,"is_published":true,"category_slug":"god","catechism_text":"God created man in his own image. Of all visible creatures only man is able to know and love his creator. The dignity of the human person is rooted in his creation in the image and likeness of God.","scripture_text":"Then God said, \"Let us make man in our image, after our likeness.\" So God created man in his own image, in the image of God he created him.","scripture_reference":"Genesis 1:26-27","catechism_paragraphs":["355","356","1700"]},{"id":"4","slug":"is-the-likeness-in-body-or-soul","answer":"This likeness to God is chiefly in my soul.","question":"Is this likeness to God in your body, or in your soul?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God is pure spirit and does not possess a physical body. Therefore, the deepest way in which we resemble God is not through our physical appearance but through our spiritual nature. Human beings possess intellect and free will, allowing them to know truth, love goodness, and freely choose how they act. These spiritual powers reflect God in a unique way. While the human body is good and created by God, it is the soul that primarily bears His image and likeness. The soul enables us to enter into communion with God, receive His grace, and respond freely to His call. This truth reminds us that human dignity comes from more than outward appearance, strength, intelligence, or worldly success.","order_index":3,"is_published":true,"category_slug":"god","catechism_text":"In Sacred Scripture the term soul often refers to human life or the entire human person. The human person, created in the image of God, is a being at once corporeal and spiritual. Endowed with a spiritual and immortal soul, the human person is ordered to God.","scripture_text":"And the dust returns to the earth as it was, and the spirit returns to God who gave it.","scripture_reference":"Ecclesiastes 12:7","catechism_paragraphs":["363","1703","1711"]},{"id":"5","slug":"how-is-your-soul-like-to-god","answer":"My soul is like to God because it is a spirit, and it is immortal.","question":"How is your soul like to God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Unlike our bodies, which are material and subject to death, the soul is spiritual. Because it is a spirit, the soul is capable of knowing God, loving God, and entering into friendship with Him. The soul is also immortal, meaning that it does not cease to exist when the body dies. At death, the soul continues to live and awaits the final resurrection of the body. This truth gives immense dignity to every human person because each soul has an eternal destiny. Catholics believe that earthly life is not the end of our existence but the beginning of a journey that continues forever. The immortality of the soul reminds us that our choices matter, our relationship with God matters, and that we are created not merely for this life but for eternity. Through sanctifying grace, the soul is prepared to share forever in the life and happiness of God in Heaven.","order_index":4,"is_published":true,"category_slug":"god","catechism_text":"The human person, created in the image of God, is a being at once corporeal and spiritual. The Church teaches that every spiritual soul is created immediately by God and is immortal: it does not perish when it separates from the body at death.","scripture_text":"And do not fear those who kill the body but cannot kill the soul; rather fear him who can destroy both soul and body in hell.","scripture_reference":"Matthew 10:28","catechism_paragraphs":["363","366","1703"]},{"id":"6","slug":"what-does-it-mean-that-your-soul-is-immortal","answer":"When I say my soul is immortal, I mean that my soul can never die.","question":"What do you mean when you say that your soul is immortal?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The soul is immortal because it is spiritual rather than material. While the body experiences death and returns to the earth, the soul continues to exist. Catholics believe that every person will live forever, either in perfect union with God or separated from Him by their own free choice. Death is therefore not the end of existence but the beginning of eternity. This truth gives great importance to the choices we make in this life. Because the soul survives death, our relationship with God matters far more than temporary earthly success or pleasure. The immortality of the soul also gives Christians hope when facing death, reminding them that God created human beings for eternal life. At the end of time, Christ will raise the dead and reunite each soul with a glorified body, completing Gods plan for His children.","order_index":5,"is_published":true,"category_slug":"god","catechism_text":"The Church teaches that every spiritual soul is immortal: it does not perish when it separates from the body at death. By death the soul is separated from the body, but in the resurrection God will give incorruptible life to our transformed body.","scripture_text":"But the souls of the righteous are in the hand of God, and no torment will ever touch them.","scripture_reference":"Wisdom 3:1","catechism_paragraphs":["366","988","1016"]},{"id":"7","slug":"why-must-you-take-care-of-your-soul","answer":"I must take more care of my soul; for Christ has said, \"What does it profit a man if he gains the whole world, and suffers the loss of his soul?\"","question":"Of which must you take more care, of your body or of your soul?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The body is a gift from God and should be respected and cared for, but the soul is even more important because it is immortal and destined for eternity. Many people spend enormous effort pursuing wealth, success, comfort, appearance, or popularity while neglecting their relationship with God. Jesus teaches that no earthly achievement can compensate for the loss of ones soul. Caring for the soul means praying regularly, receiving the sacraments, avoiding sin, growing in virtue, and seeking God in daily life. A healthy body is valuable, but even the healthiest body will eventually die. The soul, however, will live forever. Christians are therefore called to give first place to God and to the spiritual life, knowing that eternal realities are more important than temporary earthly concerns.","order_index":6,"is_published":true,"category_slug":"god","catechism_text":"Christian, recognize your dignity and now that you share in Gods own nature, do not return to your former base condition by sinning. The desire for true happiness frees man from attachment to the goods of this world.","scripture_text":"For what will it profit a man if he gains the whole world and forfeits his life? Or what shall a man give in return for his life?","scripture_reference":"Matthew 16:26","catechism_paragraphs":["1691","1810","2548"]},{"id":"16","slug":"what-is-the-first-article-of-the-creed","answer":"The first article of the Creed is, \"I believe in God, the Father almighty, Creator of heaven and earth\".","question":"What is the first article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The first article of the Apostles' Creed forms the foundation of the entire Christian faith. Before speaking about Jesus Christ, the Church first professes belief in God the Father, who created everything that exists. By calling God \"Father\", Christians express the personal relationship that God desires with humanity. By calling Him \"almighty\", they acknowledge His unlimited power and authority over all creation. By professing Him as \"Creator of heaven and earth\", believers recognise that everything visible and invisible owes its existence to God. This article reminds us that the universe is not the result of chance but of God's wisdom and love. It also teaches that every human person depends upon God and finds their ultimate purpose in Him. All the other articles of the Creed build upon this fundamental truth about God and His relationship with creation.","order_index":15,"is_published":true,"category_slug":"god","catechism_text":"Our profession of faith begins with God, for God is the First and the Last, the beginning and the end of everything. The Creed begins with God the Father, because the Father is the first divine Person of the Most Holy Trinity. We believe that God created the world according to his wisdom and love.","scripture_text":"In the beginning God created the heavens and the earth.","scripture_reference":"Genesis 1:1","catechism_paragraphs":["198","199","279"]},{"id":"17","slug":"what-is-god","answer":"God is the supreme spirit, who alone exists of himself, and is infinite in all perfection.","question":"What is God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God is not merely the greatest being within the universe. He is the Creator of all things and the source of all existence. Unlike every created thing, God depends on nothing and no one for His existence. He has always existed and always will exist. As a pure spirit, God does not have a physical body and is not limited by space or time. God possesses every perfection infinitely. His wisdom is perfect, His power is limitless, His justice is flawless, His mercy is boundless, and His love is beyond measure. Because God is infinite, human minds can never fully comprehend Him, yet He has revealed enough of Himself for us to know, love, and serve Him. Every good thing found in creation reflects something of Gods perfect goodness and points us back to Him as its source.","order_index":16,"is_published":true,"category_slug":"god","catechism_text":"God revealed himself to his people Israel by making his name known to them. The divine name \"I AM\" expresses Gods faithfulness and eternity. God is fullness of Being and of every perfection, without origin and without end.","scripture_text":"God is spirit, and those who worship him must worship in spirit and truth.","scripture_reference":"John 4:24","catechism_paragraphs":["202","212","213"]},{"id":"18","slug":"why-is-god-called-almighty","answer":"God is called almighty because he can do all things; \"For God everything is possible\".","question":"Why is God called almighty?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Gods almighty power means that nothing can prevent Him from accomplishing His holy will. He created the universe from nothing, sustains all creation in existence, and governs the world with wisdom and love. Gods power is not arbitrary or destructive. Rather, it is always exercised in harmony with His perfect goodness, wisdom, and justice. When Catholics profess that God is almighty, they are expressing complete confidence in His ability to fulfil His promises and accomplish His plan of salvation. Gods power is especially revealed in the Resurrection of Jesus Christ, through which He conquered sin and death. At the same time, Gods omnipotence does not mean that He acts contrary to His own nature. God cannot lie, sin, or cease to be God because such actions would contradict His perfect being. His almighty power is therefore the power of perfect truth, love, and goodness.","order_index":17,"is_published":true,"category_slug":"god","catechism_text":"Of all the divine attributes, only Gods omnipotence is named in the Creed. God has universal power. He is almighty because he created everything, rules everything, and can do everything. Nothing is impossible with God.","scripture_text":"But Jesus looked at them and said, \"With men this is impossible, but with God all things are possible.\"","scripture_reference":"Matthew 19:26","catechism_paragraphs":["268","269","276"]},{"id":"19","slug":"why-is-god-called-creator-of-heaven-and-earth","answer":"God is called \"Creator of heaven and earth\" because he made heaven and earth, and all things, out of nothing, by his word.","question":"Why is God called Creator of heaven and earth?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Everything that exists owes its existence to God. Before creation, nothing existed except God Himself. By His infinite power and wisdom, God freely created the entire universe. He did not need pre-existing materials or assistance from anyone. The Church teaches that God created all things \"out of nothing\", a doctrine known as creation ex nihilo. This includes everything visible, such as the earth and the stars, as well as everything invisible, such as angels. Creation is not the result of chance, necessity, or blind forces, but of Gods loving will. Because God is the Creator, all creation reflects His wisdom and goodness and ultimately belongs to Him. Recognising God as Creator should inspire gratitude, wonder, humility, and responsible stewardship of the world He has entrusted to us.","order_index":18,"is_published":true,"category_slug":"god","catechism_text":"In the beginning God created the heavens and the earth. We believe that God created the world according to his wisdom and love. God needs no pre-existent thing or any help in order to create, nor is creation any sort of necessary emanation from the divine substance. God creates freely out of nothing.","scripture_text":"In the beginning God created the heavens and the earth.","scripture_reference":"Genesis 1:1","catechism_paragraphs":["290","295","296"]},{"id":"20","slug":"had-god-any-beginning","answer":"God had no beginning: he always was, he is, and always will be.","question":"Had God any beginning?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Everything in the created world has a beginning. People are born, stars form, and even the universe itself had a beginning. God alone is different. He was not created and does not depend on anything else for His existence. God exists eternally, outside the limits of time. He does not grow older, change, or cease to exist. When God revealed Himself to Moses as \"I AM\", He revealed that He is the eternal and self-existent One. This truth gives Christians confidence because Gods promises do not change. Human beings come and go, but God remains forever the same. His love, faithfulness, truth, and power endure throughout all ages. The eternal nature of God reminds us that our lives are part of a much greater story and that our ultimate hope rests in the One who exists forever.","order_index":19,"is_published":true,"category_slug":"god","catechism_text":"God is fullness of Being and of every perfection, without origin and without end. In revealing his mysterious name, \"I AM WHO I AM\", God says who he is and by what name he is to be called forever. God alone IS.","scripture_text":"Before the mountains were brought forth, or ever you had formed the earth and the world, from everlasting to everlasting you are God.","scripture_reference":"Psalm 90:2","catechism_paragraphs":["212","213","220"]},{"id":"21","slug":"where-is-god","answer":"God is everywhere.","question":"Where is God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God is present everywhere because He is not limited by space as created things are. Nothing can exist apart from His sustaining power. God is present in every place, sees all things, and knows all things. This does not mean that God is identical with the universe or that everything is God. Rather, God remains distinct from His creation while being fully present to it. His presence extends to every person and every circumstance, even when He may seem distant. This truth is a source of comfort because Christians know that they are never abandoned by God. Whether in moments of joy, suffering, prayer, or uncertainty, God is near. Because God is everywhere, every place can become a place of encounter with Him, and no situation is beyond His knowledge, care, and providence.","order_index":20,"is_published":true,"category_slug":"god","catechism_text":"God is infinitely greater than all his works, yet because he is the free and sovereign Creator, he is present to his creatures inmost being. In him we live and move and have our being. God cares for all, from the least things to the great events of the world and its history.","scripture_text":"Where shall I go from your Spirit? Or where shall I flee from your presence? If I ascend to heaven, you are there! If I make my bed in Sheol, you are there!","scripture_reference":"Psalm 139:7-10","catechism_paragraphs":["300","301","303"]},{"id":"22","slug":"does-god-know-and-see-all-things","answer":"God knows and sees all things, even our most secret thoughts.","question":"Does God know and see all things?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God possesses perfect knowledge. Nothing is hidden from Him, whether it takes place in the past, present, or future. He knows every action, every word, and even the deepest thoughts and intentions of the human heart. This truth should not cause fear in those who love God, but rather confidence and trust. Unlike human beings, God never misunderstands us or judges based only on appearances. He sees the whole truth about every person and every situation. Gods complete knowledge also means that He is able to guide His creation with perfect wisdom and providence. He knows our struggles, our hopes, our weaknesses, and our needs even before we express them in prayer. Because God sees all things, Christians are called to live honestly before Him and to seek purity not only in outward actions but also in their thoughts and intentions.","order_index":21,"is_published":true,"category_slug":"god","catechism_text":"God sees all things and knows all things. Nothing that exists is hidden from him. The divine power is universal and mysterious. God is the Lord of all hearts and knows the secrets of men.","scripture_text":"And before him no creature is hidden, but all are open and laid bare to the eyes of him with whom we have to do.","scripture_reference":"Hebrews 4:13","catechism_paragraphs":["208","270","271"]},{"id":"23","slug":"has-god-any-body","answer":"God has no body; he is a spirit.","question":"Has God any body?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God is not a physical being and is not limited by matter, size, shape, or location. As a pure spirit, God exists beyond the limitations of the material universe that He created. Because God is spirit, He is present everywhere and is not confined to any particular place. Sometimes Scripture speaks of Gods \"hand\" or \"face\", but these descriptions are figurative language that help human beings understand something about Gods actions and presence. The fact that God is spirit does not make Him distant or unreal. Rather, it means that He is infinitely greater than anything in creation. In Jesus Christ, God the Son took on a true human nature and a real human body, but the divine nature itself remains spiritual. Understanding that God is spirit helps us recognise His transcendence while also appreciating His closeness to all who seek Him.","order_index":22,"is_published":true,"category_slug":"god","catechism_text":"God is neither man nor woman: he is God. God transcends human fatherhood and motherhood, though he is their origin and standard. God is pure spirit in which there is no place for the differences between the sexes.","scripture_text":"God is spirit, and those who worship him must worship in spirit and truth.","scripture_reference":"John 4:24","catechism_paragraphs":["370","212","239"]},{"id":"24","slug":"is-there-only-one-god","answer":"There is only one God.","question":"Is there only one God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The belief in one God is at the heart of the Catholic faith. Although many ancient cultures believed in numerous gods, God revealed to Israel that He alone is the true God and that there is no other besides Him. Christianity continues this belief and teaches that there is one divine being who created and sustains all things. This truth does not contradict the doctrine of the Trinity. Catholics believe in one God who exists eternally as three divine Persons: Father, Son, and Holy Spirit. The three Persons are not three gods but one God. Belief in one God provides unity and meaning to all of reality because everything comes from the same Creator and is directed toward Him. Christians therefore worship God alone and reject every form of idolatry that places created things in the place that belongs to God.","order_index":23,"is_published":true,"category_slug":"god","catechism_text":"These are the words with which the Niceno-Constantinopolitan Creed begins its profession of faith in the one God. To confess that God is One is rooted in divine revelation. Hear, O Israel: The Lord our God is one Lord.","scripture_text":"Hear, O Israel: The Lord our God is one Lord.","scripture_reference":"Deuteronomy 6:4","catechism_paragraphs":["200","201","228"]},{"id":"25","slug":"are-there-three-persons-in-god","answer":"There are three Persons in God; God the Father, God the Son, and God the Holy Spirit.","question":"Are there three Persons in God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God has revealed Himself as a Trinity of Persons. The Father, the Son, and the Holy Spirit are not merely different names or roles played by God, but three distinct divine Persons. The Father is not the Son, the Son is not the Holy Spirit, and the Holy Spirit is not the Father. Each Person possesses intellect, will, and the fullness of the divine nature. This truth was gradually revealed throughout salvation history and fully revealed by Jesus Christ. At His Baptism, for example, the Son stood in the Jordan, the Holy Spirit descended like a dove, and the Fathers voice was heard from Heaven. Although the mystery of the Trinity surpasses human understanding, it lies at the heart of Christian faith because it reveals that God is an eternal communion of love. Every Christian is baptised in the name of the Father, the Son, and the Holy Spirit and is called to share in their divine life.","order_index":24,"is_published":true,"category_slug":"god","catechism_text":"The mystery of the Most Holy Trinity is the central mystery of Christian faith and life. The Father is that which the Son is, the Son that which the Father is, the Father and the Son that which the Holy Spirit is, one God by nature.","scripture_text":"Go therefore and make disciples of all nations, baptising them in the name of the Father and of the Son and of the Holy Spirit.","scripture_reference":"Matthew 28:19","catechism_paragraphs":["232","253","254"]},{"id":"26","slug":"are-the-three-persons-three-gods","answer":"These three Persons are not three Gods: the Father, the Son, and the Holy Spirit are all one and the same God.","question":"Are the three Persons three Gods?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The doctrine of the Trinity does not teach the existence of three separate gods. Christianity is strictly monotheistic, meaning that there is only one God. The Father, Son, and Holy Spirit are distinct Persons, yet they possess one and the same divine nature. Each Person is fully God, not one-third of God, but there are not three Gods because there is only one divine essence. This mystery cannot be fully comprehended by human reason, yet it does not contradict reason. Throughout history, the Church has carefully defended this truth against misunderstandings that either divided God into three separate beings or denied the distinction between the Persons. The mystery of the Trinity teaches that Gods very nature is love, because from all eternity the Father, Son, and Holy Spirit exist in perfect communion. Christians therefore worship one God in three divine Persons.","order_index":25,"is_published":true,"category_slug":"god","catechism_text":"The Trinity is One. We do not confess three Gods, but one God in three Persons, the consubstantial Trinity. The divine Persons do not share the one divinity among themselves but each of them is God whole and entire.","scripture_text":"Hear, O Israel: The Lord our God is one Lord.","scripture_reference":"Deuteronomy 6:4","catechism_paragraphs":["253","255"]},{"id":"27","slug":"what-is-the-blessed-trinity","answer":"The mystery of the three Persons in one God is called the mystery of the Blessed Trinity.","question":"What is the mystery of the three Persons in one God called?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Blessed Trinity is the greatest mystery of the Christian faith because it concerns the inner life of God Himself. Human reason can know that God exists, but only God could reveal that He is Father, Son, and Holy Spirit. The Trinity is not a puzzle to be solved but a reality to be believed and contemplated. Every major aspect of Catholic life is connected to this mystery. Christians are baptised in the name of the Trinity, pray to the Father through the Son in the Holy Spirit, and are called to share forever in the life of the Trinity in Heaven. The mystery reminds us that God is not solitary but an eternal communion of love. Although we cannot fully understand the Trinity in this life, we can truly know what God has revealed about Himself and worship Him with faith and trust.","order_index":26,"is_published":true,"category_slug":"god","catechism_text":"The mystery of the Most Holy Trinity is the central mystery of Christian faith and life. God has left traces of his Trinitarian being in creation and in his Revelation throughout the Old Testament, but his inmost Being as Holy Trinity is a mystery inaccessible to reason alone.","scripture_text":"The grace of the Lord Jesus Christ and the love of God and the fellowship of the Holy Spirit be with you all.","scripture_reference":"2 Corinthians 13:14","catechism_paragraphs":["234","237","261"]},{"id":"28","slug":"what-do-you-mean-by-a-mystery","answer":"By a mystery I mean a truth which is above reason, but revealed by God.","question":"What do you mean by a mystery?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"A mystery is not something irrational or impossible. Rather, it is a truth that human reason alone could never fully discover or comprehend without Gods help. Because God is infinite and human beings are finite, there are aspects of His nature and plan that surpass our understanding. Examples include the Blessed Trinity, the Incarnation, and the Real Presence of Christ in the Eucharist. Although these mysteries are beyond reason, they are not contrary to reason. Catholics believe them because God has revealed them and because God can neither deceive nor be deceived. Throughout history, theologians have studied these mysteries and gained deeper insights into them, but their full depth can never be exhausted. Mysteries invite believers not merely to understand God intellectually but to trust Him, worship Him, and enter more deeply into His divine life.","order_index":27,"is_published":true,"category_slug":"god","catechism_text":"By natural reason man can know God with certainty on the basis of his works. But there is another order of knowledge which man cannot possibly arrive at by his own powers: the order of divine Revelation. Faith is certain because it is founded on the very word of God.","scripture_text":"For my thoughts are not your thoughts, neither are your ways my ways, says the Lord. For as the heavens are higher than the earth, so are my ways higher than your ways and my thoughts than your thoughts.","scripture_reference":"Isaiah 55:8-9","catechism_paragraphs":["50","157","237"]},{"id":"29","slug":"is-there-any-likeness-to-the-blessed-trinity-in-your-soul","answer":"There is this likeness to the Blessed Trinity in my soul: that as in one God there are three Persons, so in my one soul there are three powers.","question":"Is there any likeness to the Blessed Trinity in your soul?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The human soul is created in the image and likeness of God, and because God is a Trinity, traces of this divine image can be found within us. The Church has long taught that the soul reflects the Trinity in a limited way through its faculties of memory, understanding, and will. This comparison does not mean that the soul contains three persons or that human beings are miniature trinities. Rather, it illustrates how unity and distinction can exist together. Just as the three divine Persons are distinct yet remain one God, the different powers of the soul work together within one human person. This likeness helps us appreciate both the dignity of the human person and the fact that we are created for relationship with God. Ultimately, the image of the Trinity within us points beyond ourselves to the God whose likeness we bear.","order_index":28,"is_published":true,"category_slug":"god","catechism_text":"Christ reveals that God is love and that man is called to love. The divine image is present in every man. Created in the image of the one God and equally endowed with rational souls, all men have the same nature and the same origin.","scripture_text":"Then God said, \"Let us make man in our image, after our likeness.\"","scripture_reference":"Genesis 1:26","catechism_paragraphs":["1701","1704","1878"]},{"id":"30","slug":"which-are-the-three-powers-of-your-soul","answer":"The three powers of my soul are my memory, my understanding, and my will.","question":"Which are the three powers of your soul?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God has given every human soul spiritual faculties that allow us to know Him and respond to Him freely. Memory allows us to retain knowledge and reflect on our experiences. Understanding enables us to reason, learn truth, and contemplate God. Will gives us the ability to make choices and direct our actions toward what we believe to be good. These powers work together constantly in daily life. We remember, we understand, and then we choose. Because of original sin, these faculties can be weakened or misused, but they remain gifts from God that can be strengthened through grace. By using our memory to recall Gods blessings, our understanding to learn His truth, and our will to choose what is right, we grow in holiness and become more fully the people God created us to be.","order_index":29,"is_published":true,"category_slug":"god","catechism_text":"The human person participates in the light and power of the divine Spirit. By reason he is capable of understanding the order of things established by the Creator. By free will he is capable of directing himself toward his true good. Freedom is the power to act or not to act, and so to perform deliberate actions on ones own responsibility.","scripture_text":"Do not be conformed to this world but be transformed by the renewal of your mind, that you may prove what is the will of God, what is good and acceptable and perfect.","scripture_reference":"Romans 12:2","catechism_paragraphs":["1704","1730","1731"]},{"id":"77","slug":"what-is-the-eighth-article-of-the-creed","answer":"The eighth article of the Creed is, \"I believe in the Holy Spirit\".","question":"What is the eighth article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The eighth article of the Apostles' Creed begins the Church's profession of faith in the Third Person of the Blessed Trinity. The Holy Spirit is not an impersonal force, energy, or symbol, but a divine Person who is fully God, equal to the Father and the Son. Throughout salvation history, the Holy Spirit has been active in creation, inspired the prophets, overshadowed the Blessed Virgin Mary at the Annunciation, descended upon Christ at His Baptism, and was poured out upon the Church at Pentecost. The Holy Spirit continues to guide, sanctify, and strengthen the Church today. Through the Holy Spirit, believers receive sanctifying grace, grow in holiness, understand God's truth, and are empowered to live as faithful disciples of Christ. This article reminds Christians that the Holy Spirit is always at work drawing people into deeper communion with the Blessed Trinity.","order_index":76,"is_published":true,"category_slug":"god","catechism_text":"No one can say \"Jesus is Lord\" except by the Holy Spirit. The Holy Spirit reveals God, makes Christ known to us, and is at work with the Father and the Son from the beginning to the completion of God's plan for our salvation.","scripture_text":"Now the Lord is the Spirit, and where the Spirit of the Lord is, there is freedom.","scripture_reference":"2 Corinthians 3:17","catechism_paragraphs":["683","687","688"]},{"id":"78","slug":"who-is-the-holy-spirit","answer":"The Holy Spirit is the Third Person of the Blessed Trinity.","question":"Who is the Holy Spirit?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Holy Spirit is not an impersonal force, energy, or symbol. He is a divine Person, equal to the Father and the Son, and together with them is one God. Throughout Scripture, the Holy Spirit acts personally: He speaks, guides, teaches, comforts, and sanctifies God's people. The Holy Spirit was active in creation, inspired the prophets, descended upon Jesus at His Baptism, and was poured out upon the Church at Pentecost. Today, the Holy Spirit continues to dwell within the Church and within the souls of those who are in God's grace. Through His work, believers receive spiritual gifts, grow in holiness, understand divine truth, and are strengthened to live as faithful disciples of Christ. The Holy Spirit is often called the Sanctifier because He helps God's people become holy and draws them into deeper communion with the Father and the Son.","order_index":77,"is_published":true,"category_slug":"god","catechism_text":"To believe in the Holy Spirit is to profess that the Holy Spirit is one of the Persons of the Holy Trinity, consubstantial with the Father and the Son. The Holy Spirit reveals Christ, sanctifies the Church, and brings believers into communion with God.","scripture_text":"But the Counselor, the Holy Spirit, whom the Father will send in my name, he will teach you all things, and bring to your remembrance all that I have said to you.","scripture_reference":"John 14:26","catechism_paragraphs":["685","687","689"]},{"id":"79","slug":"from-whom-does-the-holy-spirit-proceed","answer":"The Holy Spirit proceeds from the Father and the Son.","question":"From whom does the Holy Spirit proceed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Within the mystery of the Blessed Trinity, the Holy Spirit eternally proceeds from the Father and the Son. This procession is not an event in time but an eternal relationship within the inner life of God. Just as the Son is eternally begotten of the Father, the Holy Spirit eternally proceeds from the Father and the Son. This doctrine helps Catholics understand the relationship between the three divine Persons while maintaining that there is only one God. The procession of the Holy Spirit demonstrates the perfect unity and love shared within the Trinity. Although this mystery surpasses human understanding, it has been revealed by Christ and faithfully taught by the Church. The Holy Spirit's eternal procession is reflected in His mission in the world, where He is sent by the Father and the Son to guide, sanctify, and strengthen believers.","order_index":78,"is_published":true,"category_slug":"god","catechism_text":"The Latin tradition of the Creed confesses that the Spirit proceeds from the Father and the Son. The eternal order of the divine Persons in their consubstantial communion implies that the Father is the first origin of the Spirit, but also that as Father of the only Son, he is with the Son the single principle from which the Spirit proceeds.","scripture_text":"But when the Counselor comes, whom I shall send to you from the Father, even the Spirit of truth, who proceeds from the Father, he will bear witness to me.","scripture_reference":"John 15:26","catechism_paragraphs":["246","248","264"]},{"id":"80","slug":"is-the-holy-spirit-equal-to-the-father-and-the-son","answer":"The Holy Spirit is equal to the Father and to the Son, for he is the same Lord and God as they are.","question":"Is the Holy Spirit equal to the Father and to the Son?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Holy Spirit is fully and truly God. He is not a lesser divine being, nor is He simply a power or influence of God. The Father, the Son, and the Holy Spirit each possess the one divine nature completely and perfectly. Therefore, the Holy Spirit is equal to the Father and the Son in majesty, glory, eternity, and power. From the earliest centuries, the Church defended the divinity of the Holy Spirit against those who denied it. Christians worship the Holy Spirit together with the Father and the Son because He is the same Lord and God. The Holy Spirit's divinity is revealed throughout Scripture, where He performs divine actions such as giving life, inspiring God's Word, sanctifying believers, and dwelling within the Church. To honour the Holy Spirit is to honour God Himself, for He is one with the Father and the Son in the unity of the Blessed Trinity.","order_index":79,"is_published":true,"category_slug":"god","catechism_text":"The apostolic faith concerning the Spirit was confessed by the Second Ecumenical Council at Constantinople: we believe in the Holy Spirit, the Lord and giver of life. The Holy Spirit is consubstantial with the Father and the Son and is adored and glorified with them.","scripture_text":"Now the Lord is the Spirit, and where the Spirit of the Lord is, there is freedom.","scripture_reference":"2 Corinthians 3:17","catechism_paragraphs":["245","685","690"]},{"id":"81","slug":"when-did-the-holy-spirit-come-down-on-the-apostles","answer":"The Holy Spirit came down on the Apostles at Pentecost, in the form that \"seemed like tongues of fire\".","question":"When did the Holy Spirit come down on the Apostles?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Pentecost took place fifty days after Easter and marks the public beginning of the Church's mission. Before Pentecost, the Apostles were often fearful and uncertain, despite having witnessed the Resurrection of Jesus. When the Holy Spirit came upon them, they were transformed and filled with courage, wisdom, and zeal. They immediately began preaching the Gospel, and thousands were converted. For this reason, Pentecost is often called the birthday of the Church. The coming of the Holy Spirit fulfilled Christ's promise that He would send a Helper to guide His followers into all truth. The same Holy Spirit who descended upon the Apostles continues to guide the Church today, strengthens believers through the sacraments, and equips Christians to bear witness to Christ in the world. Pentecost demonstrates that the Church's mission depends not merely on human effort but on the power of God working through His people.","order_index":80,"is_published":true,"category_slug":"god","catechism_text":"On the day of Pentecost the Holy Spirit was manifested, given, and communicated as a divine Person. Christ, having accomplished his mission, poured out the Spirit abundantly. The Church was openly displayed to the crowds and the spread of the Gospel among the nations began.","scripture_text":"And there appeared to them tongues as of fire, distributed and resting on each one of them. And they were all filled with the Holy Spirit and began to speak in other tongues, as the Spirit gave them utterance.","scripture_reference":"Acts 2:3-4","catechism_paragraphs":["731","732","767"]},{"id":"82","slug":"why-did-the-holy-spirit-come-down-on-the-apostles","answer":"The Holy Spirit came down on the Apostles to confirm their faith, to sanctify them, and to enable them to found the Church.","question":"Why did the Holy Spirit come down on the Apostles?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Apostles had been chosen and instructed by Christ, but they still needed the special help of the Holy Spirit to carry out their mission. At Pentecost, the Holy Spirit strengthened their faith, purified and sanctified them, and gave them the grace necessary to preach the Gospel boldly to all nations. Through the Spirit's guidance, the Apostles were able to teach the truth faithfully, govern the Church, and administer the sacraments. The Holy Spirit also united believers into one Body, the Church, making Pentecost the beginning of the Church's worldwide mission. This mission continues today through the successors of the Apostles and the work of the Holy Spirit in every generation. The Church depends upon the Holy Spirit for her life, unity, holiness, and fidelity to the teachings of Christ.","order_index":81,"is_published":true,"category_slug":"god","catechism_text":"The mission of Christ and the Holy Spirit is brought to completion in the Church. The Holy Spirit prepares men and goes out to them with his grace so as to draw them to Christ. Through the gift of the Spirit, the Church receives the power to proclaim and spread the Gospel.","scripture_text":"But you shall receive power when the Holy Spirit has come upon you; and you shall be my witnesses in Jerusalem and in all Judea and Samaria and to the end of the earth.","scripture_reference":"Acts 1:8","catechism_paragraphs":["737","738","767"]},{"id":"74","slug":"what-will-christ-say-to-the-wicked","answer":"Christ will say to the wicked: \"Go away from me, with your curse upon you, to the eternal fire prepared for the devil and his angels.\"","question":"What will Christ say to the wicked?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Church teaches that human beings have been given the freedom to accept or reject God's grace. At the Last Judgment, those who have definitively rejected God through unrepented mortal sin will experience eternal separation from Him. The words spoken by Christ in this passage emphasise the seriousness of human freedom and the reality of Hell. God desires all people to be saved and provides sufficient grace for salvation, but He does not force anyone to love Him. The existence of Hell demonstrates both God's justice and His respect for human freedom. At the same time, Catholics should never presume that a particular person is condemned. Instead, these warnings should inspire repentance, humility, prayer, and trust in God's mercy. Christ spoke about judgment not to drive people to despair but to call them to conversion and eternal life.","order_index":73,"is_published":true,"category_slug":"heaven-hell-purgatory","catechism_text":"To die in mortal sin without repenting and accepting God's merciful love means remaining separated from him forever by our own free choice. The chief punishment of hell is eternal separation from God. God predestines no one to go to hell; for this, a willful turning away from God is necessary.","scripture_text":"Then he will say to those at his left hand, \"Depart from me, you cursed, into the eternal fire prepared for the devil and his angels.\"","scripture_reference":"Matthew 25:41","catechism_paragraphs":["1033","1035","1037"]},{"id":"75","slug":"what-will-christ-say-to-the-just","answer":"Christ will say to the just: \"Come, you whom my Father has blessed, take for your heritage the kingdom prepared for you.\"","question":"What will Christ say to the just?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"At the Last Judgment, those who have remained faithful to God and died in his grace will be welcomed into the fullness of eternal life. Christ's words to the just reveal God's desire to share his kingdom with those who have loved and served him. Salvation is entirely a gift of God's grace, yet Christians are called to cooperate with that grace through faith, hope, charity, prayer, and obedience. The judgment described by Jesus highlights the importance of loving God and neighbour in practical ways. The righteous are praised for acts of mercy because genuine faith produces works of charity. These words of welcome are among the most comforting in Scripture because they reveal the destiny God desires for every human person. Christians should therefore live with hope, trusting in God's mercy while striving to remain faithful to Christ until the end of their lives.","order_index":74,"is_published":true,"category_slug":"heaven-hell-purgatory","catechism_text":"Those who die in God's grace and friendship and are perfectly purified live for ever with Christ. They are like God forever, for they see him as he is, face to face. Christian hope is the confident expectation of divine blessing and the beatific vision of God.","scripture_text":"Then the King will say to those at his right hand, \"Come, O blessed of my Father, inherit the kingdom prepared for you from the foundation of the world.\"","scripture_reference":"Matthew 25:34","catechism_paragraphs":["1023","1025","1821"]},{"id":"76","slug":"will-everyone-be-judged-at-death-and-at-the-last-day","answer":"Every one will be judged at death, as well as at the last day: \"Since men only die once, and after that comes judgment.\"","question":"Will every one be judged at death, as well as at the last day?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Church teaches that every person undergoes two judgments: the Particular Judgment and the Last Judgment. The Particular Judgment takes place immediately after death, when each person receives from God the particular judgment of their life and enters Heaven, Purgatory, or Hell. The Last Judgment will occur at the end of time when Christ returns in glory. At that judgment, all people will be raised from the dead and God's justice, mercy, and providence will be publicly revealed before all creation. The Last Judgment does not change the outcome of the Particular Judgment, but manifests fully the consequences of every person's choices and God's plan throughout history. This teaching reminds Christians that earthly life has eternal significance. Every action, decision, and response to God's grace matters. The certainty of judgment calls believers to repentance, holiness, and trust in God's mercy.","order_index":75,"is_published":true,"category_slug":"heaven-hell-purgatory","catechism_text":"Death puts an end to human life as the time open to either accepting or rejecting the divine grace manifested in Christ. Each man receives his eternal retribution in his immortal soul at the very moment of his death. The resurrection of all the dead will precede the Last Judgment.","scripture_text":"And just as it is appointed for men to die once, and after that comes judgment.","scripture_reference":"Hebrews 9:27","catechism_paragraphs":["1021","1022","1038"]},{"id":"31","slug":"what-is-the-second-article-of-the-creed","answer":"The second article of the Creed is, \"and in Jesus Christ, his only Son, our Lord\".","question":"What is the second article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The second article of the Apostles' Creed begins the Church's profession of faith concerning Jesus Christ. While the first article focuses on God the Father and creation, the second article introduces the Son, through whom the work of redemption is accomplished. The name Jesus means \"God saves\", revealing His mission to save humanity from sin. Christ means \"Anointed One\" or \"Messiah\", indicating that He is the Saviour promised throughout the Old Testament. By calling Jesus the only Son of God, the Creed teaches that His relationship with the Father is unique and eternal. By calling Him Lord, Christians acknowledge His divine authority and worship Him as God. This article marks the beginning of the Church's teaching on the person and work of Jesus Christ, who stands at the very centre of the Catholic faith.","order_index":30,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus means \"God saves\". The title \"Christ\" means \"Anointed One\", \"Messiah\". The title \"Lord\" indicates divine sovereignty. In the Greek translation of the Old Testament, \"Lord\" was the name most often used to translate the divine name revealed to Moses.","scripture_text":"Let all the house of Israel therefore know assuredly that God has made him both Lord and Christ, this Jesus whom you crucified.","scripture_reference":"Acts 2:36","catechism_paragraphs":["430","436","454"]},{"id":"32","slug":"who-is-jesus-christ","answer":"Jesus Christ is God the Son, made man for us.","question":"Who is Jesus Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus Christ is the eternal Son of God who became man for our salvation. This mystery is known as the Incarnation. Without ceasing to be God, the Son took on a true human nature and entered human history. He experienced human life in all things except sin. Through His teaching, miracles, suffering, death, and resurrection, He revealed the Father and accomplished the redemption of the world. Jesus is not half God and half man, nor is He a human person joined to a divine person. He is one divine Person with both a divine nature and a human nature. Because He is truly God and truly man, He is the perfect mediator between God and humanity. Everything Christians believe about salvation ultimately depends upon who Jesus is and what He has done for us.","order_index":31,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Word became flesh to save us by reconciling us with God. Jesus Christ is true God and true man in the unity of his divine Person. He is the one mediator between God and men.","scripture_text":"And the Word became flesh and dwelt among us, full of grace and truth; we have beheld his glory, glory as of the only Son from the Father.","scripture_reference":"John 1:14","catechism_paragraphs":["456","464","480"]},{"id":"33","slug":"is-jesus-christ-truly-god","answer":"Jesus Christ is truly God.","question":"Is Jesus Christ truly God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Church teaches that Jesus Christ is fully and completely God. He is not merely a holy man, prophet, or exceptionally gifted teacher. From all eternity He exists as the Son of the Father and shares the same divine nature as the Father and the Holy Spirit. Throughout the Gospels, Jesus claims divine authority, forgives sins, accepts worship, and identifies Himself in ways that reveal His divinity. The apostles came to recognise that Jesus was more than the promised Messiah; He was God made visible among men. The divinity of Christ is essential to Christianity because only God can save humanity from sin and grant eternal life. If Jesus were not truly God, His death could not have brought about the redemption of the world. The Church therefore professes and worships Jesus as Lord, equal to the Father in glory and majesty.","order_index":32,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus accepted Peter's profession of faith, which acknowledged him as the Messiah and Son of the living God. The title \"Lord\" indicates divine sovereignty. Jesus' identity as Son of God lies at the heart of the Christian faith.","scripture_text":"Thomas answered him, \"My Lord and my God!\"","scripture_reference":"John 20:28","catechism_paragraphs":["441","454","590"]},{"id":"34","slug":"why-is-jesus-christ-truly-god","answer":"Jesus Christ is truly God because he has one and the same nature with God the Father.","question":"Why is Jesus Christ truly God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus is truly God because He shares the same divine nature as the Father. He is not a creature, nor is He merely the greatest of Gods creations. From all eternity, the Son possesses everything that belongs to the divine nature. For this reason, the Church teaches that Jesus is equal to the Father in power, glory, majesty, and eternity. During His earthly ministry, Jesus claimed powers that belong to God alone, including the authority to forgive sins and judge humanity. He also accepted worship, something that no mere human being or angel could rightfully do. Christians worship Jesus because He is fully divine. The divinity of Christ is essential to salvation, for only God could perfectly reconcile humanity with Himself. By sharing the same divine nature as the Father, Jesus reveals God perfectly and makes it possible for us to become children of God through grace.","order_index":33,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Following the apostolic tradition, the Church confessed at the first ecumenical council that the Son is consubstantial with the Father, that is, one only God with him. The Father and the Son possess the same divine nature. The title Lord indicates divine sovereignty and is therefore frequently used of Jesus.","scripture_text":"I and the Father are one.","scripture_reference":"John 10:30","catechism_paragraphs":["242","253","454"]},{"id":"35","slug":"was-jesus-christ-always-god","answer":"Jesus Christ was always God, born of the Father from all eternity.","question":"Was Jesus Christ always God?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus did not begin to exist at His birth in Bethlehem. His human nature began at the Incarnation, but as the eternal Son of God He has always existed. Before all creation, before the world existed, the Son was with the Father and shared fully in the divine life. The Church teaches that the Son is eternally begotten of the Father, meaning that His divine origin is outside of time and unlike any human birth. There was never a moment when the Son did not exist. This truth distinguishes Christian belief from the mistaken idea that Jesus was merely a great man who later became divine. The Son is eternal God who entered human history for our salvation. Because Jesus is eternal, His power, authority, and saving work extend to every age and every generation.","order_index":34,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus revealed that God is Father in an unheard-of sense. The Church confesses that Jesus is eternally begotten of the Father, not made, consubstantial with the Father. The Son existed before all ages and shares fully in the divine nature.","scripture_text":"In the beginning was the Word, and the Word was with God, and the Word was God. He was in the beginning with God.","scripture_reference":"John 1:1-2","catechism_paragraphs":["240","242","479"]},{"id":"36","slug":"which-person-of-the-blessed-trinity-is-jesus-christ","answer":"Jesus Christ is the Second Person of the Blessed Trinity.","question":"Which Person of the Blessed Trinity is Jesus Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Blessed Trinity consists of three divine Persons: the Father, the Son, and the Holy Spirit. Jesus Christ is the Son, the Second Person of the Trinity. He is distinct from the Father and the Holy Spirit, yet He possesses the same divine nature as they do. When the Son became man through the Incarnation, He did not cease to be God or become a different person. The eternal Son simply took on a human nature while remaining the divine Person He had always been. Throughout the Gospels, Jesus speaks to the Father, obeys the Father, and promises to send the Holy Spirit, revealing the distinction between the three divine Persons. Understanding that Jesus is the Second Person of the Trinity helps Catholics appreciate both His true divinity and His unique role in the work of salvation. Through the Son, humanity comes to know the Father and receive the Holy Spirit.","order_index":35,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Christians are baptised in the name of the Father and of the Son and of the Holy Spirit. The Father, the Son, and the Holy Spirit are distinct from one another. The divine Persons are really distinct while possessing one and the same divine nature.","scripture_text":"And when Jesus was baptised, he went up immediately from the water, and behold, the heavens were opened and he saw the Spirit of God descending like a dove and alighting on him; and behold, a voice from heaven said, \"This is my beloved Son, with whom I am well pleased.\"","scripture_reference":"Matthew 3:16-17","catechism_paragraphs":["232","243","253"]},{"id":"37","slug":"is-jesus-christ-truly-man","answer":"Jesus Christ is truly man.","question":"Is Jesus Christ truly man?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Catholic Church teaches that Jesus Christ is truly and fully human. He was not merely God appearing to be a man, nor was His humanity somehow incomplete. Jesus experienced every aspect of human life except sin. He was born, grew, learned, worked, felt hunger and fatigue, experienced joy and sorrow, suffered, and died. Because He became truly man, He is able to represent humanity before the Father and fully share in our condition. His true humanity also reveals the dignity of human nature, since God Himself chose to assume it. By becoming man, Jesus entered human history and lived among us, showing us how to live in loving obedience to God. The Church insists upon Christs true humanity because our salvation depends upon it. As the early Church Fathers taught, what Christ did not assume could not be healed.","order_index":36,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Church confesses that Jesus is inseparably true God and true man. The Son of God worked with human hands; he thought with a human mind, acted by human choice and loved with a human heart. Born of the Virgin Mary, he has truly been made one of us in all things except sin.","scripture_text":"Therefore he had to be made like his brethren in every respect, so that he might become a merciful and faithful high priest in the service of God.","scripture_reference":"Hebrews 2:17","catechism_paragraphs":["464","470","476"]},{"id":"38","slug":"why-is-jesus-christ-truly-man","answer":"Jesus Christ is truly man because he has the nature of man, having a body and soul like ours.","question":"Why is Jesus Christ truly man?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"To be truly human, Jesus had to possess everything that belongs to human nature. The Church therefore teaches that Christ has a real human body and a real human soul. He did not merely appear human, nor was His humanity an illusion. Jesus experienced human emotions, thoughts, choices, and physical limitations, while remaining completely free from sin. At the same time, His humanity was united to His divinity in the one Person of God the Son. This union did not diminish either nature. Jesus remained fully God and fully man. Because He possesses a true human nature, He can sympathise with our struggles and serve as the perfect example of holiness. His humanity also enables Him to offer Himself on behalf of humanity, reconciling mankind to God through His sacrifice on the Cross.","order_index":37,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Son of God worked with human hands; he thought with a human mind, acted by human choice and loved with a human heart. Jesus Christ is true God and true man. Each of his two natures remains distinct while united in the one divine Person.","scripture_text":"But emptied himself, taking the form of a servant, being born in the likeness of men. And being found in human form he humbled himself and became obedient unto death, even death on a cross.","scripture_reference":"Philippians 2:7-8","catechism_paragraphs":["470","471","480"]},{"id":"39","slug":"was-jesus-christ-always-man","answer":"Jesus Christ was not always man. He has been man only from the time of his Incarnation.","question":"Was Jesus Christ always man?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Son of God existed from all eternity before becoming man. As the eternal Word, He was with the Father before the creation of the world and shared the same divine nature. At a specific moment in history, however, the Son took on a human nature through the mystery of the Incarnation. This occurred when the Virgin Mary conceived Jesus by the power of the Holy Spirit. From that moment onward, the Son possessed both a divine nature and a human nature united in one divine Person. Before the Incarnation, the Son was God but not man. After the Incarnation, He remained forever both God and man. Even now, the risen and glorified Jesus retains His human nature in Heaven. This truth reveals the extraordinary love of God, who entered human history and permanently united Himself to humanity for our salvation.","order_index":38,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Word became flesh to save us by reconciling us with God. At the appointed time, the only Son of the Father took on our human nature. Jesus Christ is true God and true man, remaining forever the incarnate Son of God.","scripture_text":"And the Word became flesh and dwelt among us, full of grace and truth; we have beheld his glory, glory as of the only Son from the Father.","scripture_reference":"John 1:14","catechism_paragraphs":["456","461","479"]},{"id":"40","slug":"what-do-you-mean-by-the-incarnation","answer":"I mean by the Incarnation that God the Son took to himself the nature of man: \"the Word was made flesh\".","question":"What do you mean by the Incarnation?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Incarnation is the mystery by which the eternal Son of God became man without ceasing to be God. At the moment of the Annunciation, through the power of the Holy Spirit, the Son took on a true human nature in the womb of the Virgin Mary. This was not the creation of a new divine person, nor was it a temporary appearance in human form. Rather, the eternal Son truly became man while remaining fully divine. The Incarnation is central to Christianity because it reveals Gods immense love for humanity. By becoming man, Jesus was able to teach us, provide an example of holiness, suffer for our sins, and restore our relationship with the Father. The Word became flesh so that humanity might be reconciled with God and share in His divine life. Every Christmas celebrates this extraordinary mystery of Gods love made visible in Jesus Christ.","order_index":39,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Word became flesh to save us by reconciling us with God. Believing that Jesus Christ is the Son of God come in the flesh is distinctive of the Christian faith. The Church calls the fact that the Son of God assumed a human nature in order to accomplish our salvation the Incarnation.","scripture_text":"And the Word became flesh and dwelt among us, full of grace and truth; we have beheld his glory, glory as of the only Son from the Father.","scripture_reference":"John 1:14","catechism_paragraphs":["456","461","463"]},{"id":"41","slug":"how-many-natures-are-there-in-jesus-christ","answer":"There are two natures in Jesus Christ, the nature of God and the nature of man.","question":"How many natures are there in Jesus Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus Christ possesses two complete natures: a divine nature and a human nature. He is fully God and fully man. The divine nature was not changed into a human nature, nor was the human nature absorbed into the divine. Both remain complete and distinct. As God, Jesus is eternal, all-powerful, and worthy of worship. As man, He was born, grew, learned, suffered, and died. The Church defended this truth throughout the centuries because it is essential to understanding who Jesus is and how He saves us. If Christ were not truly God, He could not reconcile humanity to God. If He were not truly man, He could not represent humanity or redeem human nature. The doctrine of the two natures safeguards both Christs divinity and His humanity and allows believers to understand the full meaning of the Incarnation.","order_index":40,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Church confesses that Jesus is inseparably true God and true man. Following the holy Fathers, we unanimously teach and confess one and the same Son, perfect in divinity and perfect in humanity. The Son of God worked with human hands and thought with a human mind.","scripture_text":"For in him the whole fullness of deity dwells bodily.","scripture_reference":"Colossians 2:9","catechism_paragraphs":["464","467","470"]},{"id":"42","slug":"is-there-only-one-person-in-jesus-christ","answer":"There is only one Person in Jesus Christ, which is the Person of God the Son.","question":"Is there only one Person in Jesus Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Although Jesus Christ possesses both a divine nature and a human nature, He is not two persons. He is one divine Person: the eternal Son of God. Everything Jesus does, whether through His divine nature or His human nature, is done by the one Person of the Son. This truth is sometimes called the hypostatic union, meaning the union of two natures in one divine Person. The Church teaches this doctrine to preserve the unity of Christ. When Jesus was born, suffered, taught, healed, and died, it was the Son of God acting through His human nature. Likewise, the miracles He performed revealed His divine power. Understanding that Jesus is one Person helps Catholics see that the same Jesus who walked the roads of Galilee is the eternal Son through whom all things were made. The Incarnation united God and man in the one Person of Christ forever.","order_index":41,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Church confesses that the one whom she recognises as Jesus Christ is true God and true man. We confess one and the same Christ, Son, Lord, Only-begotten, acknowledged in two natures without confusion, change, division, or separation.","scripture_text":"And the Word became flesh and dwelt among us, full of grace and truth; we have beheld his glory, glory as of the only Son from the Father.","scripture_reference":"John 1:14","catechism_paragraphs":["466","467","469"]},{"id":"43","slug":"why-was-god-the-son-made-man","answer":"God the Son was made man to redeem us from sin and hell, and to teach us the way to heaven.","question":"Why was God the Son made man?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Humanity was separated from God by sin and unable to restore that relationship through its own efforts. Out of love, God sent His Son into the world to save us. By becoming man, Jesus was able to live in perfect obedience to the Father, reveal the truth about God, and offer Himself as a sacrifice for our sins. Through His death on the Cross and His Resurrection, He conquered sin, death, and the power of the devil. Jesus did not come merely to provide moral instruction or to be an example of kindness. He came to accomplish our redemption and open the gates of Heaven. At the same time, His teachings and example show us how to live as children of God. Through faith, baptism, and participation in the life of the Church, believers receive the graces won by Christ and are guided along the path that leads to eternal life.","order_index":42,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Word became flesh for us in order to save us by reconciling us with God. The Word became flesh so that thus we might know God's love. The Word became flesh to be our model of holiness and make us partakers of the divine nature.","scripture_text":"For the Son of man came to seek and to save the lost.","scripture_reference":"Luke 19:10","catechism_paragraphs":["457","458","459"]},{"id":"44","slug":"what-does-the-holy-name-jesus-mean","answer":"The holy name Jesus means Saviour.","question":"What does the holy name Jesus mean?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The name Jesus is rich in meaning and reveals Christ's mission. It comes from a Hebrew name meaning \"God saves\". Before Jesus was born, the angel instructed Saint Joseph to give Him this name because He would save His people from their sins. The name is therefore not merely a personal identifier but a declaration of who Jesus is and why He came into the world. Throughout Christian history, Catholics have shown special reverence for the Holy Name of Jesus because it reminds them of God's saving love. The Church encourages devotion to the Holy Name and frequently invokes it in prayer and worship. Every time Christians call upon the name of Jesus, they express faith in the One who alone has the power to redeem humanity and bring salvation to the world.","order_index":43,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The name Jesus means \"God saves\". The child born of the Virgin Mary is called Jesus, for he will save his people from their sins. The name Jesus contains all: God and man and the whole economy of creation and salvation.","scripture_text":"She will bear a son, and you shall call his name Jesus, for he will save his people from their sins.","scripture_reference":"Matthew 1:21","catechism_paragraphs":["430","432","435"]},{"id":"45","slug":"what-does-the-name-christ-mean","answer":"The name Christ means Anointed.","question":"What does the name Christ mean?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The title Christ comes from a Greek word meaning \"Anointed One\" and is equivalent to the Hebrew title Messiah. In the Old Testament, kings, priests, and prophets were often anointed with oil as a sign that they had been chosen by God for a special mission. Jesus perfectly fulfils all of these roles. He is the eternal King who reigns over the Kingdom of God, the perfect High Priest who offers Himself for the salvation of the world, and the supreme Prophet who reveals the Father completely. By calling Jesus the Christ, Christians proclaim that He is the long-awaited Messiah promised throughout the Scriptures. He is the fulfilment of God's covenant promises and the Saviour whom Israel and the nations were awaiting. The title Christ therefore expresses both His identity and His mission in God's plan of salvation.","order_index":44,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Christ comes from the Greek translation of the Hebrew term Messiah, which means anointed. Jesus fulfilled the messianic hope of Israel in his threefold office of priest, prophet, and king.","scripture_text":"He first found his brother Simon and said to him, \"We have found the Messiah\" (which means Christ).","scripture_reference":"John 1:41","catechism_paragraphs":["436","437","440"]},{"id":"46","slug":"where-is-jesus-christ","answer":"As God, Jesus Christ is everywhere. As God made man, he is in heaven, and in the Blessed Sacrament of the Altar.","question":"Where is Jesus Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Because Jesus Christ is truly God, He possesses all the attributes of God, including omnipresence. As God, He is present everywhere and sustains all creation. However, Jesus is also truly man. After His Resurrection and Ascension, His glorified human body entered Heaven, where He sits at the right hand of the Father. Yet Christ has not abandoned His Church. In a unique and wonderful way, He remains truly present in the Eucharist. The Church teaches that in the Blessed Sacrament, Jesus is present Body, Blood, Soul, and Divinity. This presence is called \"real\" because it is not merely symbolic but substantial. For this reason Catholics adore Christ in the Eucharist and show great reverence toward the tabernacle. Whether in Heaven reigning in glory or sacramentally present on earth, Jesus remains close to His people and continues His work of sanctification and salvation.","order_index":45,"is_published":true,"category_slug":"jesus-christ","catechism_text":"In the most blessed sacrament of the Eucharist the body and blood, together with the soul and divinity, of our Lord Jesus Christ are truly, really, and substantially contained. Christ is seated at the right hand of the Father, yet remains mysteriously present to his Church, especially in the Eucharist.","scripture_text":"And behold, I am with you always, to the close of the age.","scripture_reference":"Matthew 28:20","catechism_paragraphs":["1374","1377","669"]},{"id":"47","slug":"what-is-the-third-article-of-the-creed","answer":"The third article of the Creed is, \"who was conceived by the Holy Spirit, born of the Virgin Mary\".","question":"What is the third article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The third article of the Apostles' Creed professes the mystery of the Incarnation. It declares that Jesus Christ entered human history through a miraculous conception by the power of the Holy Spirit and was born of the Virgin Mary. This article emphasises both Christ's divine origin and His true humanity. The conception of Jesus was not the result of a human father but was brought about by the Holy Spirit according to God's saving plan. At the same time, Jesus was truly born of Mary and therefore truly became one of us. This profession of faith reminds Catholics that salvation is not simply an idea or a moral teaching but a real event in history. God truly entered our world and took on human nature in order to redeem humanity from sin and restore us to friendship with Himself.","order_index":46,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Annunciation to Mary inaugurates the fullness of time. The mission of the Holy Spirit is always conjoined and ordered to that of the Son. God sent forth his Son, but to prepare a body for him, he wanted the free cooperation of a creature.","scripture_text":"And the angel said to her, \"The Holy Spirit will come upon you, and the power of the Most High will overshadow you; therefore the child to be born will be called holy, the Son of God.\"","scripture_reference":"Luke 1:35","catechism_paragraphs":["484","485","488"]},{"id":"48","slug":"what-does-the-third-article-mean","answer":"The third article means that God the Son took a body and soul like ours, in the womb of the Blessed Virgin Mary, by the power of the Holy Spirit.","question":"What does the third article mean?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The third article teaches how the Son of God became man. Jesus did not come into existence at His conception, since He is the eternal Son of God. Rather, at the Annunciation, He took to Himself a true human nature through the power of the Holy Spirit. From the very first moment of His conception, Jesus possessed both a complete human nature and a complete divine nature united in one divine Person. The Virgin Mary freely cooperated with Gods plan by accepting the angels message with faith and obedience. Because Jesus was conceived by the power of the Holy Spirit and not by a human father, His conception was entirely miraculous. This article therefore highlights both Christs divinity and His true humanity. It reminds Catholics that salvation began not at the Cross or the Resurrection but at the moment when the eternal Word became flesh in the womb of Mary. Through the Incarnation, God entered human history in order to redeem it from within.","order_index":47,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Annunciation to Mary inaugurates the fullness of time. The mission of the Holy Spirit is always conjoined and ordered to that of the Son. From the first formulations of her faith, the Church has confessed that Jesus was conceived solely by the power of the Holy Spirit in the womb of the Virgin Mary.","scripture_text":"And the angel said to her, \"The Holy Spirit will come upon you, and the power of the Most High will overshadow you; therefore the child to be born will be called holy, the Son of God.\"","scripture_reference":"Luke 1:35","catechism_paragraphs":["484","485","496"]},{"id":"49","slug":"had-jesus-christ-any-father-on-earth","answer":"Jesus Christ had no father on earth: St Joseph was only his guardian or foster father.","question":"Had Jesus Christ any father on earth?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus was conceived by the power of the Holy Spirit in the womb of the Virgin Mary and therefore did not have a human father. Saint Joseph was chosen by God to be Marys husband and the guardian of Jesus. Although Joseph was not the biological father of Christ, he lovingly fulfilled the duties of a father by protecting, providing for, and raising Him. Through Joseph, Jesus grew up within a holy family and learned the customs and traditions of Israel. The Church honours Saint Joseph as the foster father of Jesus, the spouse of the Blessed Virgin Mary, and the patron of the universal Church. His faithful obedience, humility, and trust in God make him a model for all Christians. Josephs unique role in salvation history demonstrates how God entrusts important responsibilities to ordinary people who are willing to follow His will.","order_index":48,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Joseph was called by God to take Mary as his wife and give legal fatherhood to Jesus. The Gospel accounts understand the virginal conception of Jesus as a divine work that surpasses all human understanding. Jesus lived hidden for most of his life, sharing the ordinary condition of a family.","scripture_text":"But as he considered this, behold, an angel of the Lord appeared to him in a dream, saying, \"Joseph, son of David, do not fear to take Mary your wife, for that which is conceived in her is of the Holy Spirit; she will bear a son, and you shall call his name Jesus.\"","scripture_reference":"Matthew 1:20-21","catechism_paragraphs":["437","497","532"]},{"id":"50","slug":"where-was-our-saviour-born","answer":"Our Saviour was born in a stable at Bethlehem.","question":"Where was our Saviour born?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus Christ was born in Bethlehem, the city foretold by the prophets as the birthplace of the Messiah. Although He is the King of Kings and Lord of Lords, He chose to enter the world in poverty and humility. Because there was no room for Mary and Joseph in the inn, Jesus was born in humble surroundings and placed in a manger. This reveals an important truth about Gods kingdom: He does not measure greatness by wealth, status, or power. The circumstances of Christs birth show Gods closeness to the poor, the forgotten, and the humble. Bethlehem therefore stands as a powerful reminder that God often works through what the world considers insignificant. Every Christmas, Christians remember the birth of Jesus and give thanks that God came among us, not with earthly splendour, but with humility, love, and simplicity.","order_index":49,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus was born in a humble stable, into a poor family. Simple shepherds were the first witnesses to this event. In this poverty heavens glory was made manifest. To become a child in relation to God is the condition for entering the kingdom.","scripture_text":"And while they were there, the time came for her to be delivered. And she gave birth to her first-born son and wrapped him in swaddling cloths, and laid him in a manger, because there was no place for them in the inn.","scripture_reference":"Luke 2:6-7","catechism_paragraphs":["525","526"]},{"id":"51","slug":"on-what-day-was-our-saviour-born","answer":"Our Saviour was born on Christmas Day.","question":"On what day was our Saviour born?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Christmas Day is the feast on which Christians celebrate the birth of Jesus Christ. The Church celebrates Christmas on 25 December, commemorating the Incarnation and birth of the Son of God. While Scripture does not reveal the exact calendar date of Christs birth, the Church established this feast to honour the moment when God entered human history as a man. Christmas is therefore much more than a celebration of a babys birth. It is the celebration of the Incarnation, the beginning of Gods work of redemption through Jesus Christ. The feast reminds believers that God loved the world so greatly that He sent His only Son for its salvation. Through prayer, worship, charity, and joy, Christians celebrate the coming of Emmanuel, which means \"God with us\".","order_index":50,"is_published":true,"category_slug":"jesus-christ","catechism_text":"To become a child in relation to God is the condition for entering the kingdom. Jesus birth manifests Gods goodness and loving kindness. The faithful celebrate the mysteries of Christs life throughout the liturgical year, beginning with his Nativity.","scripture_text":"And the angel said to them, \"Be not afraid; for behold, I bring you good news of a great joy which will come to all the people; for to you is born this day in the city of David a Saviour, who is Christ the Lord.\"","scripture_reference":"Luke 2:10-11","catechism_paragraphs":["525","526","563"]},{"id":"52","slug":"what-is-the-fourth-article-of-the-creed","answer":"The fourth article of the Creed is, \"suffered under Pontius Pilate, was crucified, died and was buried.\"","question":"What is the fourth article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The fourth article proclaims the saving Passion and Death of Jesus Christ. Unlike myths or legends, Christs suffering took place at a specific moment in human history under the Roman governor Pontius Pilate. The Creed therefore emphasises that Jesus truly suffered, truly died, and was truly buried. His death was not an accident or merely the result of human cruelty. Rather, Jesus freely accepted suffering and death out of love for humanity and obedience to the Fathers plan of salvation. Through His sacrifice on the Cross, He atoned for sin and reconciled mankind with God. The mention of His burial further confirms the reality of His death before His glorious Resurrection. Every time Catholics recite the Creed, they profess their belief that Christs Passion was the decisive act through which God redeemed the world.","order_index":51,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Paschal mystery of Christs Cross and Resurrection stands at the centre of the Good News. Jesus violent death was not the result of chance but part of the mystery of Gods plan. The cross is the unique sacrifice of Christ, the one mediator between God and men.","scripture_text":"He himself bore our sins in his body on the tree, that we might die to sin and live to righteousness. By his wounds you have been healed.","scripture_reference":"1 Peter 2:24","catechism_paragraphs":["571","599","618"]},{"id":"53","slug":"what-were-the-chief-sufferings-of-christ","answer":"The chief sufferings of Christ were: first, his agony, and his sweat of blood in the Garden; secondly, his being scourged at the pillar, and crowned with thorns; and thirdly his carrying his cross, his crucifixion, and his death between two thieves.","question":"What were the chief sufferings of Christ?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Passion of Christ reveals both the seriousness of sin and the depth of Gods love. Before His arrest, Jesus entered into profound agony in the Garden of Gethsemane, where He accepted the Fathers will and experienced such anguish that His sweat became like drops of blood. He was then unjustly condemned, scourged, mocked, and crowned with thorns. After carrying His Cross through the streets of Jerusalem, He was crucified between two criminals and endured immense physical suffering, humiliation, and rejection. Yet throughout these sufferings, Jesus remained obedient to the Father and continued to love those who persecuted Him. Catholics meditate on these events through devotions such as the Stations of the Cross and the Sorrowful Mysteries of the Rosary. Christs sufferings were not meaningless. He willingly endured them to redeem humanity from sin and to demonstrate the immeasurable love of God for every person.","order_index":52,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The cup of the New Covenant, which Jesus anticipated when he offered himself at the Last Supper, he accepted afterwards from his Fathers hands in his agony in the garden. Christ suffered for us and offered his life as a sacrifice for our sins. By his holy and precious blood, he merited justification for us.","scripture_text":"But he was wounded for our transgressions, he was bruised for our iniquities; upon him was the chastisement that made us whole, and with his stripes we are healed.","scripture_reference":"Isaiah 53:5","catechism_paragraphs":["612","618","619"]},{"id":"54","slug":"what-are-the-chief-sufferings-of-our-lord-called","answer":"The chief sufferings of our Lord are called the Passion of Jesus Christ.","question":"What are the chief sufferings of our Lord called?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The word \"Passion\" comes from a Latin word meaning \"to suffer\". The Passion of Jesus Christ refers to the events of His suffering from His agony in the Garden of Gethsemane until His death on the Cross. The Church recalls the Passion in a special way during Holy Week, particularly on Good Friday. Christ did not suffer because He was powerless to avoid suffering. Rather, He freely accepted it out of love for humanity and obedience to the Father's will. Through His Passion, Jesus took upon Himself the consequences of sin and offered the perfect sacrifice for the salvation of the world. Catholics meditate on the Passion through prayer, the Stations of the Cross, the Rosary, and the liturgy because these events reveal the depth of God's love and the cost of our redemption. The Passion remains at the heart of Christian faith and devotion.","order_index":53,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Paschal mystery of Christ's Cross and Resurrection stands at the centre of the Good News. Christ's whole life is a mystery of redemption. The cross is the unique sacrifice of Christ, the one mediator between God and men.","scripture_text":"Greater love has no man than this, that a man lay down his life for his friends.","scripture_reference":"John 15:13","catechism_paragraphs":["571","572","618"]},{"id":"55","slug":"why-did-our-saviour-suffer","answer":"Our Saviour suffered to atone for our sins, and to purchase for us eternal life.","question":"Why did our Saviour suffer?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Sin separates humanity from God and no human being could fully repair the damage caused by sin. Out of love, Jesus willingly suffered and died to reconcile humanity with the Father. His sacrifice on the Cross atoned for sin by offering perfect obedience and love in place of humanity's disobedience. Through His suffering and death, Christ opened the way to forgiveness, grace, and eternal life. This does not mean that people are saved automatically regardless of their response to God. Rather, Christ won the graces necessary for salvation and invites every person to accept them through faith, repentance, and participation in the life of the Church. The sufferings of Jesus demonstrate both the seriousness of sin and the immeasurable mercy of God. Whenever Catholics look upon the Cross, they are reminded of the price of redemption and the depth of Christ's love for the world.","order_index":54,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus atoned for our faults and made satisfaction for our sins to the Father. By his loving obedience to the Father, unto death on the Cross, Jesus fulfills the atoning mission of the suffering servant. The cross is the unique sacrifice of Christ.","scripture_text":"For Christ also died for sins once for all, the righteous for the unrighteous, that he might bring us to God.","scripture_reference":"1 Peter 3:18","catechism_paragraphs":["599","615","618"]},{"id":"56","slug":"why-is-jesus-christ-called-our-redeemer","answer":"Jesus Christ is called our Redeemer because his precious blood is the price by which we were ransomed.","question":"Why is Jesus Christ called our Redeemer?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"To redeem means to buy back or set free by paying a price. Humanity had fallen under the power of sin and death and could not free itself. Jesus Christ redeemed us through His Passion, Death, and Resurrection. The New Testament frequently speaks of believers being purchased or ransomed by the precious blood of Christ. This language highlights the immense value of Christ's sacrifice and the cost of our salvation. The Church does not teach that God paid a literal price to someone, but rather that the sacrifice of Christ perfectly accomplished what was necessary to reconcile humanity with God. Because Jesus is both true God and true man, His sacrifice possesses infinite value. Through His redeeming work, believers are freed from slavery to sin and invited into the freedom and dignity of the children of God.","order_index":55,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Son of God freely accepted his Father's plan of divine salvation. Christ's whole life is an offering to the Father. The redemption won by Christ consists in this, that he came to give his life as a ransom for many, that is, he loved his own to the end.","scripture_text":"You know that you were ransomed from the futile ways inherited from your fathers, not with perishable things such as silver or gold, but with the precious blood of Christ, like that of a lamb without blemish or spot.","scripture_reference":"1 Peter 1:18-19","catechism_paragraphs":["601","607","622"]},{"id":"57","slug":"on-what-day-did-our-saviour-die","answer":"Our Saviour died on Good Friday.","question":"On what day did our Saviour die?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Good Friday is the day on which Christians commemorate the suffering and death of Jesus Christ on the Cross. It is called \"Good\" not because of the suffering involved, but because of the great good that Christ accomplished through His sacrifice. On that day, Jesus offered Himself freely for the salvation of the world, reconciling humanity with God and opening the way to eternal life. The Church observes Good Friday with solemnity, prayer, fasting, and reflection upon the Passion. Although it is a day marked by sorrow, it is also a day of hope because Christ's death was not the end of the story. Good Friday leads to Easter Sunday, when the Church celebrates Christ's victory over sin and death through His Resurrection. Together, these events form the heart of the Christian faith and the foundation of our salvation.","order_index":56,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Christ's death is both the Paschal sacrifice that accomplishes the definitive redemption of men and the sacrifice of the New Covenant. By his holy Cross he has redeemed the world. By the grace of God, Jesus tasted death for every man.","scripture_text":"When Jesus had received the vinegar, he said, \"It is finished\"; and he bowed his head and gave up his spirit.","scripture_reference":"John 19:30","catechism_paragraphs":["613","617","624"]},{"id":"58","slug":"where-did-our-saviour-die","answer":"Our Saviour died on Mount Calvary.","question":"Where did our Saviour die?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Calvary, also known as Golgotha, was the place outside Jerusalem where Jesus was crucified. The name Golgotha means \"Place of a Skull\". There, Jesus was nailed to the Cross between two criminals and offered His life for the salvation of the world. Calvary stands at the centre of Christian history because it was the place where Christ accomplished the work of redemption. What appeared to be a place of defeat became the place of victory over sin and death. Throughout the centuries, Christians have regarded Calvary with deep reverence and devotion. The Cross raised on Calvary has become the universal symbol of Christianity, reminding believers of God's love and the sacrifice by which they were redeemed. Every Mass makes present the one sacrifice of Calvary, allowing Christians to participate in the saving mystery of Christ's Passion.","order_index":57,"is_published":true,"category_slug":"jesus-christ","catechism_text":"By his holy Cross he has redeemed the world. The sacrifice of Christ and the sacrifice of the Eucharist are one single sacrifice. The cross is the unique sacrifice of Christ, the one mediator between God and men.","scripture_text":"And when they came to the place which is called The Skull, there they crucified him, and the criminals, one on the right hand and one on the left.","scripture_reference":"Luke 23:33","catechism_paragraphs":["617","618","1367"]},{"id":"62","slug":"what-is-the-fifth-article-of-the-creed","answer":"The fifth article of the Creed is, \"he descended into hell; on the third day he rose again from the dead\".","question":"What is the fifth article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The fifth article of the Creed proclaims two important events that took place between Christ's death and Ascension: His descent into hell and His Resurrection. The word \"hell\" in this context does not mean the place of eternal punishment. Rather, it refers to the abode of the dead, where the just of the Old Testament awaited the coming of the Redeemer. By descending among the dead, Christ proclaimed His victory and opened Heaven to those who had died in friendship with God before His coming. On the third day, He rose bodily from the dead, conquering sin and death forever. The Resurrection is the crowning truth of the Christian faith and the foundation of Christian hope. It confirms that Jesus is truly the Son of God and that His sacrifice on the Cross accomplished our salvation. Through His victory, Christ has opened the way for all who believe in Him to share in eternal life.","order_index":61,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus descended into the depths of death so that the dead would hear the voice of the Son of God and those who hear will live. The Resurrection of Jesus is the crowning truth of our faith in Christ, a faith believed and lived as the central truth by the first Christian community.","scripture_text":"Christ died for our sins in accordance with the scriptures, that he was buried, that he was raised on the third day in accordance with the scriptures.","scripture_reference":"1 Corinthians 15:3-4","catechism_paragraphs":["631","632","638"]},{"id":"63","slug":"what-do-you-mean-he-descended-into-hell","answer":"By the words \"he descended into hell\" I mean that, as soon as Christ was dead, his blessed Soul went down into that part of Hell called Limbo.","question":"What do you mean by the words, \"he descended into hell\"?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"In the Apostles' Creed, the phrase \"he descended into hell\" does not refer to the Hell of the damned. The Church teaches that after His death, Christ descended to the abode of the dead, where the righteous who had died before His coming awaited redemption. Traditional catechisms often refer to this state as the Limbo of the Fathers or Abraham's Bosom. These holy men and women, including figures such as Abraham, Moses, David, and the prophets, could not enter Heaven until Christ had completed His saving work. By descending among the dead, Jesus proclaimed His victory over sin and death and brought the just into the fullness of salvation. This event demonstrates that Christ's redemption extends to all times and all peoples. The descent into hell forms an important part of the Paschal Mystery, showing that Jesus truly experienced death and triumphed over it from within.","order_index":62,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The frequent New Testament affirmations that Jesus was raised from the dead presuppose that the crucified one sojourned in the realm of the dead prior to his resurrection. Jesus did not descend into hell to deliver the damned, but to free the just who had gone before him.","scripture_text":"For Christ also died for sins once for all, the righteous for the unrighteous, that he might bring us to God, being put to death in the flesh but made alive in the spirit; in which he went and preached to the spirits in prison.","scripture_reference":"1 Peter 3:18-19","catechism_paragraphs":["632","633","634"]},{"id":"64","slug":"what-do-you-mean-by-limbo","answer":"By Limbo I mean a place of rest, where the souls of the just who died before Christ were detained.","question":"What do you mean by Limbo?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"In the Penny Catechism, the word \"Limbo\" refers to what is traditionally called the Limbo of the Fathers or Abraham's Bosom. It was not a place of punishment but a state of peace where the righteous who had died before Christ awaited the coming of the Redeemer. These holy men and women had lived by faith and friendship with God, but Heaven had not yet been opened through Christ's saving Death and Resurrection. The Church teaches that when Jesus descended among the dead, He announced the Good News of salvation and brought these just souls into the presence of God. Modern Catholic teaching more commonly speaks of the \"abode of the dead\" or the state of the righteous awaiting redemption, but the reality remains the same. This doctrine emphasises that Christ's saving work extends not only to those living after His coming but also to the faithful who awaited Him throughout salvation history.","order_index":63,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Scripture calls the abode of the dead, to which the dead Christ went down, \"hell\" because those who are there are deprived of the vision of God. Jesus did not descend into hell to deliver the damned, but to free the just who had gone before him. The Gospel was preached even to the dead.","scripture_text":"The poor man died and was carried by the angels to Abraham's bosom. The rich man also died and was buried.","scripture_reference":"Luke 16:22","catechism_paragraphs":["633","634","635"]},{"id":"65","slug":"why-were-the-souls-of-the-just-detained-in-limbo","answer":"The souls of the just were detained in Limbo because they could not go up to the kingdom of heaven till Christ had opened it for them.","question":"Why were the souls of the just detained in Limbo?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Before the redemption accomplished by Jesus Christ, Heaven was not yet opened to humanity. Although the righteous of the Old Testament lived and died in God's friendship, they still awaited the coming of the promised Messiah who would conquer sin and death. Because of Adam's fall, mankind could not enter the full vision of God until Christ completed His saving mission. When Jesus died on the Cross and descended among the dead, He announced His victory and led the just into Heaven. This teaching highlights the central role of Christ in God's plan of salvation. No one reaches Heaven apart from Him. The patriarchs, prophets, and all the faithful of the Old Covenant were ultimately saved through the merits of Christ, even though they lived before His earthly life. His redemption transcends time and reaches both those who came before Him and those who come after Him.","order_index":64,"is_published":true,"category_slug":"jesus-christ","catechism_text":"By his death and Resurrection, Jesus Christ has opened Heaven to us. Jesus descended into the abode of the dead and opened Heaven's gates for the just who had gone before him. Christ is risen from the dead, opening for us the way to a new life.","scripture_text":"Therefore he is the mediator of a new covenant, so that those who are called may receive the promised eternal inheritance, since a death has occurred which redeems them from the transgressions under the first covenant.","scripture_reference":"Hebrews 9:15","catechism_paragraphs":["1026","633","637"]},{"id":"66","slug":"what-do-you-mean-by-on-the-third-day-he-rose-again","answer":"By the words \"on the third day he rose again from the dead\", I mean that, after Christ had been dead and buried part of three days, he raised his blessed Body to life again on the third day.","question":"What do you mean by the words, \"on the third day he rose again from the dead\"?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Resurrection of Jesus Christ is the central event of the Christian faith. After truly suffering, dying, and being buried, Jesus rose bodily from the dead on the third day. His Resurrection was not merely the survival of His soul or a symbolic return in the memories of His followers. The same body that was crucified and laid in the tomb was raised and glorified by the power of God. Through His Resurrection, Christ conquered sin, death, and the power of the devil. The Resurrection confirms that Jesus is truly the Son of God and that His sacrifice on the Cross accomplished the salvation of the world. It also gives Christians confidence in their own future resurrection. Because Christ lives forever, those who belong to Him have the hope of eternal life. The Resurrection transforms the Cross from a sign of defeat into the sign of Christ's victory and triumph.","order_index":65,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Resurrection of Jesus is the crowning truth of our faith in Christ. Christ's Resurrection was a real event with manifestations that were historically verified by his disciples. Christ is risen from the dead, and in him all will be made alive.","scripture_text":"He is not here, but has risen. Remember how he told you, while he was still in Galilee, that the Son of man must be delivered into the hands of sinful men, and be crucified, and on the third day rise.","scripture_reference":"Luke 24:6-7","catechism_paragraphs":["638","646","655"]},{"id":"67","slug":"on-what-day-did-christ-rise-again-from-the-dead","answer":"Christ rose again from the dead on Easter Sunday.","question":"On what day did Christ rise again from the dead?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Easter Sunday is the greatest feast of the Christian year because it celebrates the Resurrection of Jesus Christ. After His death on Good Friday and His burial, Christ rose triumphantly from the dead on the first day of the week. The Resurrection is the foundation of Christian hope because it demonstrates Christ's victory over sin and death. Every Sunday is celebrated by Christians as the Lord's Day because it commemorates this victory. Easter is not simply the remembrance of a past event but the celebration of a living reality. The risen Christ continues to be present in His Church, especially through the sacraments. By rising from the dead, Jesus opened the way to eternal life for all who believe in Him. Easter therefore stands at the centre of the Church's liturgical year and remains the source of Christian joy and hope.","order_index":66,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Resurrection of Jesus is the crowning truth of our faith in Christ. Sunday is expressly distinguished from the sabbath and follows chronologically every week. It is the day of Christ's Resurrection and is rightly called the Lord's Day.","scripture_text":"But the angel said to the women, \"Do not be afraid; for I know that you seek Jesus who was crucified. He is not here; for he has risen, as he said. Come, see the place where he lay.\"","scripture_reference":"Matthew 28:5-6","catechism_paragraphs":["638","647","1166"]},{"id":"68","slug":"what-is-the-sixth-article-of-the-creed","answer":"The sixth article of the Creed is, \"he ascended into heaven, and is seated at the right hand of God the Father almighty\".","question":"What is the sixth article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The sixth article of the Creed professes Christ's Ascension into Heaven and His exaltation at the right hand of the Father. After His Resurrection, Jesus remained with His disciples for forty days, teaching them and preparing them for the coming of the Holy Spirit. He then ascended into Heaven in their sight. The Ascension does not mean that Jesus abandoned His Church. Rather, having completed His earthly mission, He entered fully into His heavenly glory and continues to intercede for His people before the Father. The phrase \"seated at the right hand of God\" does not refer to a physical location, but signifies Christ's supreme authority, honour, and kingship. From Heaven, He reigns as Lord of all creation and guides His Church through the Holy Spirit. The Ascension also gives Christians hope, because where Christ has gone, His faithful followers are called to follow.","order_index":67,"is_published":true,"category_slug":"jesus-christ","catechism_text":"The Lord Jesus, after speaking to them, was taken up into heaven and took his seat at the right hand of God. Christ's Ascension marks the definitive entrance of Jesus' humanity into God's heavenly domain. Seated at the Father's right hand, Christ inaugurates the Kingdom of the Messiah.","scripture_text":"So then the Lord Jesus, after he had spoken to them, was taken up into heaven, and sat down at the right hand of God.","scripture_reference":"Mark 16:19","catechism_paragraphs":["659","663","665"]},{"id":"69","slug":"what-do-you-mean-by-he-ascended-into-heaven","answer":"By the words \"he ascended into heaven\", I mean that our Saviour went up Body and Soul into heaven on Ascension Day forty days after his Resurrection.","question":"What do you mean by the words, \"he ascended into heaven\"?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Forty days after His Resurrection, Jesus Christ ascended into Heaven in the presence of His apostles. Unlike the saints, who enter Heaven through God's grace, Jesus ascended by His own divine power because He is the Son of God. His Ascension completed His earthly mission and marked the beginning of a new phase in salvation history. Christ did not leave behind His humanity when He ascended. Rather, He entered Heaven with His glorified human body and soul, demonstrating the destiny that awaits those who remain faithful to Him. The Ascension is therefore a source of great hope for Christians. It teaches that human nature has been raised to a place of honour in Heaven and that Christ continually intercedes for us before the Father. While He is no longer visibly present on earth, He remains present through His Church, His Word, and especially through the sacraments.","order_index":68,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Jesus Christ, the head of the Church, precedes us into the Father's glorious kingdom so that we, the members of his Body, may live in the hope of one day being with him forever. Having entered the sanctuary of heaven once and for all, Christ intercedes constantly for us.","scripture_text":"And when he had said this, as they were looking on, he was lifted up, and a cloud took him out of their sight. And while they were gazing into heaven as he went, behold, two men stood by them in white robes, and said, \"Men of Galilee, why do you stand looking into heaven? This Jesus, who was taken up from you into heaven, will come in the same way as you saw him go into heaven.\"","scripture_reference":"Acts 1:9-11","catechism_paragraphs":["659","660","665"]},{"id":"70","slug":"what-do-you-mean-by-seated-at-the-right-hand-of-the-father","answer":"By the words, \"is seated at the right hand of God the Father Almighty\", I do not mean that God the Father has hands, for he is a spirit; but I mean that Christ, as God, is equal to the Father and, as man, is in the highest place in Heaven.","question":"What do you mean by the words, \"and is seated at the right hand of God the Father Almighty\"?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"When the Creed says that Christ is seated at the right hand of the Father, it is using symbolic language to express a profound spiritual reality. Since God is pure spirit and does not possess a physical body, He does not literally sit on a throne with Christ beside Him. In biblical language, the right hand is the place of honour, authority, and power. The Creed therefore teaches that Jesus Christ, having completed His earthly mission, now reigns in glory with the Father. As the eternal Son, He is equal to the Father in divinity. As man, He has been exalted above all creation and entered fully into heavenly glory. This truth gives Christians great confidence because the same Jesus who suffered, died, and rose again now reigns as Lord of Heaven and earth. From His place of glory, He intercedes for His people and governs His Church until He comes again in glory.","order_index":69,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Being seated at the Father's right hand signifies the inauguration of the Messiah's kingdom. Christ's Ascension marks the definitive entrance of Jesus' humanity into God's heavenly domain. There he permanently exercises his priesthood, for he always lives to make intercession for those who draw near to God through him.","scripture_text":"When he had made purification for sins, he sat down at the right hand of the Majesty on high.","scripture_reference":"Hebrews 1:3","catechism_paragraphs":["663","664","665"]},{"id":"71","slug":"what-is-the-seventh-article-of-the-creed","answer":"The seventh article of the Creed is, \"from there he will come to judge the living and the dead\".","question":"What is the seventh article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The seventh article of the Creed teaches that Jesus Christ will return in glory at the end of time to judge all humanity. The same Lord who ascended into Heaven will come again as Judge of the living and the dead. This judgment will reveal the truth about every person's life, choices, and response to God's grace. Christ's return, often called the Second Coming, is an essential part of Christian hope. Catholics do not view the Last Judgment merely as a cause of fear, but as the moment when God's justice and mercy will be fully revealed. Evil will be defeated, the faithful will be vindicated, and God's kingdom will be brought to its fullness. The certainty of Christ's return encourages Christians to live faithfully, remain vigilant in prayer, and persevere in holiness. Every generation of believers lives in hopeful expectation of the day when Christ will come again in glory.","order_index":70,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Christ is Lord of eternal life. The Son did not come to judge, but to save and to give the life he has in himself. By rejecting grace in this life, one already judges oneself. At the end of time, Christ will come in glory to achieve the definitive triumph of good over evil.","scripture_text":"And he commanded us to preach to the people, and to testify that he is the one ordained by God to be judge of the living and the dead.","scripture_reference":"Acts 10:42","catechism_paragraphs":["668","681","682"]},{"id":"72","slug":"when-will-christ-come-again","answer":"Christ will come again from heaven at the last day, to judge all mankind.","question":"When will Christ come again?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus Christ will return in glory at the end of time to bring history to its fulfilment and judge all people. This event is often called the Second Coming. Although Christ has revealed that He will come again, He has not revealed the exact day or hour. Christians are therefore called to live in continual readiness, remaining faithful to God through prayer, holiness, and perseverance. The return of Christ will not be a hidden or symbolic event but a glorious manifestation of His divine authority before all creation. At His coming, the dead will be raised, the final judgment will take place, and God's kingdom will be fully established. For believers, the Second Coming is not merely something to fear but a source of hope, because it will mark the complete victory of Christ over sin, evil, and death. The Church therefore lives in constant expectation of the Lord's return.","order_index":71,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Since the Ascension Christ's coming in glory has been imminent. On Judgment Day at the end of the world, Christ will come in glory to achieve the definitive triumph of good over evil. Christ is Lord of eternal life and has the right to pass definitive judgment on the works and hearts of men.","scripture_text":"Then will appear the sign of the Son of man in heaven, and then all the tribes of the earth will mourn, and they will see the Son of man coming on the clouds of heaven with power and great glory.","scripture_reference":"Matthew 24:30","catechism_paragraphs":["673","681","682"]},{"id":"73","slug":"what-are-the-things-christ-will-judge","answer":"Christ will judge our thoughts, words, works, and omissions.","question":"What are the things Christ will judge?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Christ's judgment will extend to every aspect of human life. Not only our outward actions, but also our thoughts, motives, words, and failures to do good will be brought into the light. The Church teaches that God sees the human heart and knows every circumstance surrounding our actions. At the Last Judgment, all truth will be revealed and God's perfect justice will be made manifest. This truth reminds Christians that discipleship is not merely about avoiding evil actions but also about cultivating purity of heart, truthful speech, charity towards others, and faithful obedience to God's will. Sins of omission, the good we failed to do when we had the opportunity, are also important in God's sight. The certainty of judgment encourages believers to examine their conscience regularly, repent of sin, and seek to live lives pleasing to God.","order_index":72,"is_published":true,"category_slug":"jesus-christ","catechism_text":"Following in the steps of the prophets and John the Baptist, Jesus announced the judgment of the Last Day. Then will the conduct of each one and the secrets of hearts be brought to light. The Last Judgment will reveal even to its furthest consequences the good each person has done or failed to do during his earthly life.","scripture_text":"For God will bring every deed into judgment, with every secret thing, whether good or evil.","scripture_reference":"Ecclesiastes 12:14","catechism_paragraphs":["678","679","1039"]},{"id":"59","slug":"why-do-we-make-the-sign-of-the-cross","answer":"We make the sign of the cross - first, to put us in mind of the Blessed Trinity; and secondly, to remind us that God the Son died for us on the Cross.","question":"Why do we make the sign of the cross?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Sign of the Cross is one of the oldest and most important prayers in Christianity. When Catholics trace the cross upon themselves while saying \"In the name of the Father, and of the Son, and of the Holy Spirit\", they profess two central mysteries of the faith: the Blessed Trinity and the saving death of Jesus Christ. The words recall the three divine Persons, while the gesture of the cross recalls Christ's sacrifice on Calvary. The Sign of the Cross is therefore much more than a habit or greeting. It is a brief profession of faith, a prayer, and a reminder of our baptism. Catholics make the Sign of the Cross at the beginning and end of prayer, before receiving blessings, and during the liturgy. By making this sign with reverence, Christians place themselves under God's protection and renew their commitment to live as disciples of Christ.","order_index":58,"is_published":true,"category_slug":"prayer","catechism_text":"The Christian begins his day, his prayers and activities with the Sign of the Cross: \"In the name of the Father and of the Son and of the Holy Spirit. Amen.\" The sign of the cross strengthens us in temptations and difficulties and recalls our baptism into Christ.","scripture_text":"Go therefore and make disciples of all nations, baptising them in the name of the Father and of the Son and of the Holy Spirit.","scripture_reference":"Matthew 28:19","catechism_paragraphs":["2157","1235","1668"]},{"id":"60","slug":"how-does-the-sign-of-the-cross-remind-us-of-the-blessed-trinity","answer":"In making the sign of the cross we are reminded of the Blessed Trinity by the words, \"In the name of the Father, and of the Son, and of the Holy Spirit\".","question":"In making the sign of the cross how are we reminded of the Blessed Trinity?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Sign of the Cross is a brief profession of faith in the mystery of the Blessed Trinity. Every time Catholics say the words \"In the name of the Father, and of the Son, and of the Holy Spirit\", they acknowledge the one God who exists eternally as three divine Persons. The wording is significant because Christians say \"name\", not \"names\", affirming that there is one God, not three gods. At the same time, the three Persons are individually named, expressing the distinction between the Father, the Son, and the Holy Spirit. This simple prayer therefore contains one of the deepest truths of the Christian faith. By beginning and ending prayers with these words, Catholics place themselves consciously in the presence of the Triune God and renew the faith received at Baptism. The Sign of the Cross serves as a daily reminder that Christian life begins, continues, and ends in communion with the Blessed Trinity.","order_index":59,"is_published":true,"category_slug":"prayer","catechism_text":"Christians are baptised in the name of the Father and of the Son and of the Holy Spirit. The mystery of the Most Holy Trinity is the central mystery of Christian faith and life. The Christian begins his day, his prayers and activities with the Sign of the Cross.","scripture_text":"Go therefore and make disciples of all nations, baptising them in the name of the Father and of the Son and of the Holy Spirit.","scripture_reference":"Matthew 28:19","catechism_paragraphs":["232","233","2157"]},{"id":"61","slug":"how-does-the-sign-of-the-cross-remind-us-that-christ-died-for-us","answer":"In making the sign of the cross we are reminded that Christ died for us on the cross by the very form of the cross which we make upon ourselves.","question":"In making the sign of the cross how are we reminded that Christ died for us on the Cross?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The gesture of tracing the cross upon ourselves reminds us of the instrument by which Jesus redeemed the world. The Cross stands at the centre of Christianity because it was there that Christ offered His life for the forgiveness of sins and the salvation of humanity. Every Sign of the Cross therefore serves as a brief remembrance of Christ's Passion and Death. It is not merely a symbolic movement of the hand but a visible profession of faith in the saving work of Jesus. By making the Sign of the Cross, Catholics recall the price of their redemption and express gratitude for Christ's sacrifice. The gesture also reminds believers that they are called to take up their own cross and follow Him. In this way, the Sign of the Cross unites the mysteries of the Trinity and the Redemption in one simple yet profound act of faith.","order_index":60,"is_published":true,"category_slug":"prayer","catechism_text":"The cross is the unique sacrifice of Christ, the one mediator between God and men. The Sign of the Cross marks us with the seal of Christ. The Christian begins his day, his prayers and activities with the Sign of the Cross, placing himself under the grace of the Saviour.","scripture_text":"But far be it from me to glory except in the cross of our Lord Jesus Christ, by which the world has been crucified to me, and I to the world.","scripture_reference":"Galatians 6:14","catechism_paragraphs":["618","1235","2157"]},{"id":"8","slug":"what-must-you-do-to-save-your-soul","answer":"To save my soul I must worship God by Faith, Hope and Charity; that is, I must believe in him, I must hope in him, and I must love him with my whole heart.","question":"What must you do to save your soul?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God desires the salvation of every person and provides the grace necessary for us to reach Heaven. The Christian life is built upon the three theological virtues of Faith, Hope, and Charity. Through Faith we believe what God has revealed. Through Hope we trust in Gods promises and seek eternal life. Through Charity we love God above all things and love our neighbour for His sake. These virtues are gifts from God that are strengthened through prayer, the sacraments, and faithful Christian living. Salvation is not simply about knowing facts about God but about entering into a living relationship with Him. As believers grow in Faith, Hope, and Charity, they become more fully united to Christ and better equipped to persevere in holiness throughout their lives.","order_index":7,"is_published":true,"category_slug":"salvation","catechism_text":"The human virtues are rooted in the theological virtues, which adapt mans faculties for participation in the divine nature. The theological virtues are faith, hope, and charity. Charity is the theological virtue by which we love God above all things for his own sake.","scripture_text":"So faith, hope, love abide, these three; but the greatest of these is love.","scripture_reference":"1 Corinthians 13:13","catechism_paragraphs":["1812","1813","1822"]},{"id":"9","slug":"what-is-faith","answer":"Faith is a supernatural gift of God, which enables us to believe without doubting whatever God has revealed.","question":"What is faith?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Faith is much more than a feeling or personal opinion. It is a gift from God that enables us to accept as true everything that He has revealed. Because God is perfectly truthful, Catholics trust His word even when some mysteries exceed human understanding. Faith does not oppose reason; rather, it perfects and elevates it. Through faith we come to know God, accept His promises, and place our trust in Jesus Christ. Faith is received as a gift but must be freely embraced and continually nourished. Prayer, Scripture, study, and participation in the sacraments help faith to grow stronger. Without faith it is impossible to please God fully because faith is the foundation upon which the entire Christian life is built.","order_index":8,"is_published":true,"category_slug":"salvation","catechism_text":"Faith is a supernatural virtue by which we believe in God and believe all that he has said and revealed to us, because he is truth itself. By faith man freely commits his entire self to God.","scripture_text":"Now faith is the assurance of things hoped for, the conviction of things not seen.","scripture_reference":"Hebrews 11:1","catechism_paragraphs":["153","154","1814"]},{"id":"10","slug":"why-must-you-believe-what-god-has-revealed","answer":"I must believe whatever God has revealed because God is the very truth, and can neither deceive nor be deceived.","question":"Why must you believe whatever God has revealed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Catholic faith rests ultimately on the trustworthiness of God Himself. Human beings can make mistakes, misunderstand facts, or even intentionally deceive others. God, however, is perfect truth. Because He knows all things perfectly and possesses absolute goodness, He can never lie or be mistaken. When God reveals something for our salvation, Christians can accept it with complete confidence. This certainty does not arise from our own intelligence but from Gods authority. Even when certain teachings are difficult to understand, believers trust the God who has revealed them. The act of faith is therefore an act of trust in Gods wisdom, goodness, and truthfulness. Believing what God has revealed draws us into a deeper relationship with Him and allows us to build our lives on a foundation that cannot fail.","order_index":9,"is_published":true,"category_slug":"salvation","catechism_text":"What moves us to believe is not the fact that revealed truths appear as true and intelligible in the light of our natural reason, but the authority of God himself who reveals them, who can neither deceive nor be deceived. God is the fullness of Truth.","scripture_text":"In hope of eternal life which God, who never lies, promised ages ago.","scripture_reference":"Titus 1:2","catechism_paragraphs":["156","157","215"]},{"id":"11","slug":"how-do-you-know-what-god-has-revealed","answer":"I am to know what God has revealed by the testimony, teaching, and authority of the Catholic Church.","question":"How are you to know what God has revealed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"God did not leave humanity to discover revealed truth on its own. Jesus established a visible Church and entrusted it with the responsibility of preserving and proclaiming His teachings. Before the New Testament was written, the apostles preached the Gospel and handed on what they had received from Christ. The Catholic Church continues this apostolic mission through Scripture, Sacred Tradition, and the teaching authority known as the Magisterium. Catholics therefore do not rely solely on private interpretation when seeking to understand divine revelation. Instead, they trust the Church that Christ founded and guided by the Holy Spirit. The Church faithfully safeguards the truths necessary for salvation and helps believers understand Gods revelation correctly. Through the Churches teaching, Christians can confidently know the faith that has been handed down from the apostles throughout the centuries.","order_index":10,"is_published":true,"category_slug":"the-church","catechism_text":"Sacred Tradition and Sacred Scripture make up a single sacred deposit of the Word of God, entrusted to the Church. The task of giving an authentic interpretation of the Word of God has been entrusted to the living teaching office of the Church alone, whose authority is exercised in the name of Jesus Christ.","scripture_text":"The church of the living God is the pillar and bulwark of the truth.","scripture_reference":"1 Timothy 3:15","catechism_paragraphs":["80","85","87"]},{"id":"12","slug":"who-gave-the-church-authority-to-teach","answer":"Jesus Christ gave the Catholic Church divine authority to teach when he said, \"Go therefore, make disciples of all the nations\".","question":"Who gave the Catholic Church divine authority to teach?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The authority of the Catholic Church does not come from human wisdom, political power, or popular opinion. It comes from Jesus Christ Himself. Before ascending into Heaven, Christ commissioned the apostles to teach all nations, baptise believers, and hand on everything He had commanded. This mission did not end with the death of the apostles but continues through their successors, the bishops, united with the Pope. The Churchs teaching authority exists to preserve and faithfully explain the revelation entrusted to it by Christ. Catholics believe that when the Church officially teaches on matters of faith and morals, the Holy Spirit assists her so that the Gospel may be transmitted accurately from generation to generation. This divine mission gives Christians confidence that the Church remains a trustworthy guide in matters concerning salvation and the Christian life.","order_index":11,"is_published":true,"category_slug":"the-church","catechism_text":"Bishops, with priests as co-workers, have as their first task to preach the Gospel of God to all men. The Church, the pillar and bulwark of the truth, has received this solemn command of Christ from the apostles to announce the saving truth.","scripture_text":"Go therefore and make disciples of all nations, baptising them in the name of the Father and of the Son and of the Holy Spirit, teaching them to observe all that I have commanded you; and behold, I am with you always, to the close of the age.","scripture_reference":"Matthew 28:19-20","catechism_paragraphs":["888","889","2034"]},{"id":"13","slug":"what-are-the-chief-things-god-has-revealed","answer":"The chief things which God has revealed are contained in the Apostles' Creed.","question":"What are the chief things which God has revealed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Apostles' Creed is one of the oldest and most important summaries of the Christian faith. It contains the essential truths that God has revealed about Himself, creation, salvation, the Church, and eternal life. From the earliest centuries, Christians used the Creed to profess their faith, especially before Baptism. Although the Creed does not contain every Church teaching, it provides a concise summary of the core beliefs that all Catholics are called to accept. The Creed helps unite believers in a common profession of faith and serves as a foundation for further catechesis. By learning and praying the Creed, Catholics deepen their understanding of the truths revealed by God and handed down by the Church throughout the ages.","order_index":12,"is_published":true,"category_slug":"the-church","catechism_text":"From the beginning, the apostolic Church expressed and handed on her faith in brief formulae. Such syntheses are called professions of faith since they summarise the faith professed by Christians. The Apostles' Creed is the ancient baptismal symbol of the Church of Rome.","scripture_text":"Follow the pattern of the sound words which you have heard from me, in the faith and love which are in Christ Jesus; guard the truth that has been entrusted to you by the Holy Spirit who dwells within us.","scripture_reference":"2 Timothy 1:13-14","catechism_paragraphs":["186","187","197"]},{"id":"14","slug":"say-the-apostles-creed","answer":"I believe in God, the Father almighty, Creator of heaven and earth; and in Jesus Christ, his only Son, our Lord; who was conceived by the Holy Spirit, born of the Virgin Mary, suffered under Pontius Pilate, was crucified, died and was buried. He descended into hell; the third day he rose again from the dead; he ascended into heaven; and sits at the right hand of God the Father almighty; from thence he shall come to judge the living and the dead. I believe in the Holy Spirit; the holy Catholic Church; the communion of saints; the forgiveness of sins; the resurrection of the body; and life everlasting. Amen.","question":"Say the Apostles' Creed.","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Apostles' Creed is one of the most important prayers and professions of faith in the Catholic Church. For nearly two thousand years, Christians have recited it to publicly proclaim what they believe about God, Jesus Christ, the Holy Spirit, the Church, and eternal life. The Creed provides a concise summary of the central truths of Christianity and serves as a foundation for Catholic teaching. It is recited during the Rosary and frequently used in the Church's liturgy. Learning the Creed helps Catholics understand not only what they believe but also why they believe it. Each statement within the Creed expresses an important truth revealed by God and handed down through the apostles. By praying the Creed thoughtfully, believers renew their commitment to the faith and unite themselves with Christians throughout the world and across history.","order_index":13,"is_published":true,"category_slug":"the-church","catechism_text":"Whoever says \"I believe\" says \"I pledge myself to what we believe.\" Communion in faith needs a common language of faith, normative for all and uniting all in the same confession of faith. The Apostles' Creed is rightly considered to be a faithful summary of the apostles' faith.","scripture_text":"Because, if you confess with your lips that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved.","scripture_reference":"Romans 10:9","catechism_paragraphs":["185","197","199"]},{"id":"15","slug":"how-is-the-apostles-creed-divided","answer":"The Apostles' Creed is divided into twelve parts or articles.","question":"How is the Apostles' Creed divided?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Apostles' Creed is traditionally divided into twelve articles, each expressing an essential truth of the Christian faith. The articles begin with belief in God the Father as Creator, continue through the life, death, resurrection, and glorification of Jesus Christ, and conclude with the Holy Spirit, the Church, forgiveness of sins, resurrection of the body, and life everlasting. This structure helps Catholics understand the Creed as more than a prayer to be memorised. It is a summary of salvation history and a guide to the truths revealed by God. The division into articles also makes the Creed easier to study systematically, which is why many catechisms explain the faith article by article. By understanding each article, Catholics gain a deeper appreciation of the unity and beauty of the Christian faith.","order_index":14,"is_published":true,"category_slug":"the-church","catechism_text":"The Creed is divided into three parts: the first speaks of the first divine Person and the wonderful work of creation; the next speaks of the second divine Person and the mystery of man's redemption; the third speaks of the Holy Spirit, the origin and source of our sanctification. These are further divided into twelve articles.","scripture_text":"One Lord, one faith, one baptism, one God and Father of us all, who is above all and through all and in all.","scripture_reference":"Ephesians 4:5-6","catechism_paragraphs":["190","191"]},{"id":"83","slug":"what-is-the-ninth-article-of-the-creed","answer":"The ninth article of the Creed is, \"the Holy Catholic Church, the communion of saints\".","question":"What is the ninth article of the Creed?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The ninth article professes faith in the Church founded by Jesus Christ and in the communion that exists among all who belong to Him. The Church is not merely a human organisation but the Body of Christ, guided by the Holy Spirit and entrusted with the mission of proclaiming the Gospel and administering the sacraments. The phrase \"Holy Catholic Church\" expresses the Church's divine origin, universal mission, and call to holiness. The \"communion of saints\" refers to the spiritual union that exists between the faithful on earth, the souls being purified after death, and the saints in Heaven. All members of Christ's Body are united through Him and share in spiritual goods such as prayer, grace, and charity. This article reminds Catholics that Christianity is not meant to be lived in isolation. Believers are part of a worldwide family united in Christ across time and eternity.","order_index":82,"is_published":true,"category_slug":"the-church","catechism_text":"The Church is the People that God gathers in the whole world. The communion of saints is the Church. There exists a constant bond of charity and an abundant exchange of spiritual goods among the faithful on earth, the souls in purgatory, and the saints in Heaven.","scripture_text":"For just as the body is one and has many members, and all the members of the body, though many, are one body, so it is with Christ. For by one Spirit we were all baptised into one body.","scripture_reference":"1 Corinthians 12:12-13","catechism_paragraphs":["748","946","954"]},{"id":"84","slug":"what-is-the-catholic-church","answer":"The Catholic Church is the union of all the faithful under one Head.","question":"What is the Catholic Church?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"The Catholic Church is not merely a human organisation or a collection of believers with similar opinions. It is the Body of Christ founded by Jesus Himself and united by one faith, one worship, and one baptism. All who belong fully to the Church are joined together under Christ, sharing in the same spiritual life and mission. The Church exists to continue the work of Jesus in the world by preaching the Gospel, administering the sacraments, and helping people attain salvation. Throughout history, the Church has spread to every nation while remaining one family united in Christ. This unity is visible through the profession of the same faith and communion with the successors of the apostles. The Church is both human and divine: human because it is made up of people, and divine because Christ is its founder and the Holy Spirit is its soul and guide.","order_index":83,"is_published":true,"category_slug":"the-church","catechism_text":"The Church is the Body of Christ. The faithful are united with Christ and with one another in this Body. What characterises the unity of the Church is one Lord, one faith, one baptism, and one common hope rooted in Christ.","scripture_text":"Now you are the body of Christ and individually members of it.","scripture_reference":"1 Corinthians 12:27","catechism_paragraphs":["777","789","815"]},{"id":"85","slug":"who-is-the-head-of-the-catholic-church","answer":"The Head of the Catholic Church is Jesus Christ our Lord.","question":"Who is Head of the Catholic Church?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Jesus Christ is the true and supreme Head of the Church. He founded the Church, redeemed it through His Blood, and continues to guide it through the Holy Spirit. All authority within the Church ultimately comes from Him and exists to serve His mission. Because Christ is risen and lives forever, He remains actively present in His Church, especially through the sacraments, Sacred Scripture, and the ministry of the apostles' successors. While the Church has visible leaders on earth, including bishops and the Pope, none of them replace Christ. Their role is to serve as His representatives and shepherd His people according to His teachings. Recognising Christ as the Head of the Church reminds Catholics that the Church belongs to Him and that her primary mission is to lead all people into communion with Him and His saving work.","order_index":84,"is_published":true,"category_slug":"the-church","catechism_text":"Christ is the head of the Body, the Church. He is the principle of creation and redemption. Raised to the Father's glory, Christ now precedes us so that we may live in hope of being with him forever. Christ and the Church together make up the whole Christ.","scripture_text":"He is the head of the body, the church; he is the beginning, the first-born from the dead, that in everything he might be pre-eminent.","scripture_reference":"Colossians 1:18","catechism_paragraphs":["792","794","795"]},{"id":"86","slug":"has-the-church-a-visible-head-on-earth","answer":"The Church has a visible Head on earth - the Bishop of Rome, who is the Vicar of Christ.","question":"Has the Church a visible Head on earth?","created_at":"2026-11-10T09:59:47.759632+00:00","updated_at":"2026-11-10T09:59:47.759632+00:00","explanation":"Although Jesus Christ is the invisible and supreme Head of the Church, He established a visible structure to preserve unity among His followers. The Bishop of Rome, commonly called the Pope, is the successor of Saint Peter, whom Christ appointed to strengthen his brethren and shepherd His flock. The title \"Vicar of Christ\" means that the Pope serves as Christ's representative on earth, not as a replacement for Christ. Catholics believe that the Pope has a unique role in preserving the unity of the Church and safeguarding the deposit of faith entrusted to the apostles. Throughout history, the Popes have served as visible signs of communion among Catholics worldwide. While individual Popes are human and capable of personal faults, Catholics believe that Christ continues to guide His Church through the office established for Peter and his successors.","order_index":85,"is_published":true,"category_slug":"the-church","catechism_text":"Christ, in instituting the Twelve, constituted them in the form of a college with Peter at their head. The Lord made Simon alone, whom he named Peter, the rock of his Church. The Pope, Bishop of Rome and Peter's successor, is the perpetual and visible source and foundation of the unity of the whole Church.","scripture_text":"And I tell you, you are Peter, and on this rock I will build my church, and the powers of death shall not prevail against it. I will give you the keys of the kingdom of heaven.","scripture_reference":"Matthew 16:18-19","catechism_paragraphs":["880","881","882"]}]$cathoscroll_topics$::jsonb) AS x;

INSERT INTO public.offline_catalogue_revision (singleton, revision, floor_revision) VALUES (true, 0, 0);

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
$function$;

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
END;$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION catho_private.prevent_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN RAISE EXCEPTION 'Administrator audit records are append-only' USING ERRCODE='42501'; END;$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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

ALTER FUNCTION catho_private.get_user_feed_preference_signals(uuid) OWNER TO postgres;
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
$function$;



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
$function$;

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
$function$;

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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.is_cathoscroll_content_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT catho_private.is_cathoscroll_content_admin()
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.offline_catalogue_head()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('revision', revision::text)
  FROM public.offline_catalogue_revision WHERE singleton
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.set_content_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

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
$function$;


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

-- Reset inherited/default table and sequence access before restoring the
-- source project's explicit ACL. This is essential on fresh Supabase projects,
-- where default privileges may otherwise leave broad authenticated writes.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA catho_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

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

-- Column-level grants are part of the source security model.
-- Comments expose only non-content metadata to anonymous clients. Authenticated
-- clients can read only non-content metadata directly. Comment text is available
-- exclusively through get_topic_comment_page, which enforces publication and
-- deleted/hidden-comment rules. Authenticated inserts still accept content;
-- private moderation and internal columns remain hidden.
GRANT SELECT (id, topic_id, parent_id, user_id, created_at, edited_at, is_deleted, is_pinned) ON TABLE public.comments TO anon;
GRANT SELECT (id, topic_id, parent_id, user_id, created_at, edited_at, is_deleted, is_pinned) ON TABLE public.comments TO authenticated;
GRANT INSERT (topic_id, parent_id, user_id, content) ON TABLE public.comments TO authenticated;
GRANT UPDATE (content, edited_at, is_deleted) ON TABLE public.comments TO authenticated;

-- Like-table SELECT grants expose only the keys needed for ownership checks,
-- duplicate detection, counts, and filtered deletes. RLS still limits rows.
GRANT SELECT (comment_id, user_id) ON TABLE public.comment_likes TO authenticated;
GRANT INSERT (id, user_id, comment_id, created_at) ON TABLE public.comment_likes TO authenticated;
GRANT SELECT (topic_id, user_id) ON TABLE public.topic_likes TO authenticated;
GRANT INSERT (id, user_id, topic_id, created_at) ON TABLE public.topic_likes TO authenticated;
GRANT SELECT (id, username, display_name, bio) ON TABLE public.profiles TO anon;
GRANT SELECT (id, username, display_name, bio) ON TABLE public.profiles TO authenticated;
GRANT INSERT (id, username, display_name, bio) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (username, display_name, bio) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

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
-- Preserve least-privilege defaults for future objects as well as the
-- explicit grants above. New public tables/sequences must not become writable
-- by anon/authenticated merely because of project-level default ACLs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- Preserve the source project's service_role defaults for future objects.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- Private feed analytics telemetry. Raw rows are available only through
-- authenticated, validated RPC ingestion and server-side aggregate queries.
CREATE TABLE catho_private.feed_analytics_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'impression', 'viewable_impression', 'active_duration', 'skip',
    'swipe_depth', 'completion', 'return_visit'
  )),
  entity_type text NOT NULL CHECK (entity_type = 'topic'),
  entity_id text NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT feed_analytics_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT feed_analytics_metadata_size CHECK (octet_length(metadata::text) <= 1024),
  CONSTRAINT feed_analytics_events_pkey PRIMARY KEY (user_id, event_id)
);
CREATE TABLE catho_private.feed_analytics_event_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0)
);

-- Durable daily aggregates keep admin reporting inexpensive after raw-event retention.
-- The viewer bridge is pseudonymous and is retained only for the same 180-day window.
CREATE TABLE catho_private.feed_analytics_daily (
  event_date date NOT NULL,
  entity_id text NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  viewable_impressions bigint NOT NULL DEFAULT 0 CHECK (viewable_impressions >= 0),
  active_duration_ms bigint NOT NULL DEFAULT 0 CHECK (active_duration_ms >= 0),
  skips bigint NOT NULL DEFAULT 0 CHECK (skips >= 0),
  completions bigint NOT NULL DEFAULT 0 CHECK (completions >= 0),
  return_visits bigint NOT NULL DEFAULT 0 CHECK (return_visits >= 0),
  refreshed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (event_date, entity_id)
);
CREATE INDEX feed_analytics_daily_entity_date_idx
  ON catho_private.feed_analytics_daily (entity_id, event_date DESC);

CREATE TABLE catho_private.feed_analytics_daily_viewers (
  event_date date NOT NULL,
  entity_id text NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_date, entity_id, user_id)
);
CREATE INDEX feed_analytics_daily_viewers_entity_date_user_idx
  ON catho_private.feed_analytics_daily_viewers (entity_id, event_date, user_id);
CREATE INDEX feed_analytics_daily_viewers_user_date_idx
  ON catho_private.feed_analytics_daily_viewers (user_id, event_date DESC);
ALTER TABLE catho_private.feed_analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.feed_analytics_daily_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.feed_analytics_daily FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.feed_analytics_daily_viewers FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX feed_analytics_events_topic_time_idx
  ON catho_private.feed_analytics_events (entity_id, received_at DESC);

CREATE INDEX feed_analytics_events_type_time_idx
  ON catho_private.feed_analytics_events (event_type, received_at DESC);
CREATE INDEX feed_analytics_events_received_at_idx
  ON catho_private.feed_analytics_events (received_at);

CREATE INDEX feed_analytics_events_user_time_idx
  ON catho_private.feed_analytics_events (user_id, received_at DESC)
  INCLUDE (entity_id)
  WHERE event_type IN (
    'viewable_impression',
    'active_duration',
    'skip',
    'swipe_depth',
    'completion',
    'return_visit'
  );
ALTER TABLE catho_private.feed_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.feed_analytics_event_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.feed_analytics_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.feed_analytics_event_limits FROM PUBLIC, anon, authenticated, service_role;

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
    PERFORM 1 FROM auth.users AS account WHERE account.id = v_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
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
CREATE OR REPLACE FUNCTION catho_private.prune_feed_analytics_events(
  p_before timestamp with time zone DEFAULT (statement_timestamp() - interval '180 days'),
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'catho_private'
AS $function$
DECLARE
  v_deleted integer := 0;
  v_viewers_deleted integer := 0;
  v_limits_deleted integer := 0;
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
  GET DIAGNOSTICS v_viewers_deleted = ROW_COUNT;

  WITH expired_limits AS (
    SELECT event_limit.ctid
    FROM catho_private.feed_analytics_event_limits AS event_limit
    WHERE event_limit.window_started_at < p_before
    ORDER BY event_limit.window_started_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.feed_analytics_event_limits AS event_limit
  USING expired_limits
  WHERE event_limit.ctid = expired_limits.ctid;
  GET DIAGNOSTICS v_limits_deleted = ROW_COUNT;

  RETURN v_deleted + v_viewers_deleted + v_limits_deleted;
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
  event_type text NOT NULL CHECK (event_type IN ('viewable_impression', 'click')),
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
  viewable_impressions bigint NOT NULL DEFAULT 0 CHECK (viewable_impressions >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (event_date, campaign_id)
);
CREATE INDEX sponsor_campaign_daily_campaign_date_idx ON catho_private.sponsor_campaign_daily (campaign_id, event_date DESC);

ALTER TABLE catho_private.sponsor_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.sponsor_campaign_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_daily FROM PUBLIC, anon, authenticated, service_role;

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
    PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sponsor campaign request' USING ERRCODE = '42501'; END IF;
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
    PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '42501'; END IF;
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
CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.sponsor_memberships AS m
    WHERE m.sponsor_id = p_sponsor_id
      AND m.user_id = p_actor_user_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH campaigns AS (
    SELECT c.id, c.campaign_name, c.status
    FROM public.sponsor_campaigns AS c
    WHERE c.sponsor_id = p_sponsor_id
  ),
  signed_in AS (
    SELECT
      d.campaign_id,
      sum(d.served_count) AS served,
      sum(d.viewable_impressions) AS viewable_impressions,
      sum(d.clicks) AS clicks
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date BETWEEN p_from AND p_to
    GROUP BY d.campaign_id
  ),
  signed_out AS (
    SELECT
      d.campaign_id,
      sum(d.served_count) AS served
    FROM catho_private.anonymous_sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date BETWEEN p_from AND p_to
    GROUP BY d.campaign_id
  ),
  metrics AS (
    SELECT
      c.id AS campaign_id,
      c.campaign_name,
      c.status,
      coalesce(si.served, 0) AS served,
      coalesce(si.viewable_impressions, 0) AS viewable_impressions,
      coalesce(si.clicks, 0) AS clicks,
      coalesce(so.served, 0) AS anonymous_served
    FROM campaigns AS c
    LEFT JOIN signed_in AS si ON si.campaign_id = c.id
    LEFT JOIN signed_out AS so ON so.campaign_id = c.id
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'campaign_id', m.campaign_id,
          'campaign_name', m.campaign_name,
          'status', m.status,
          'served', m.served,
          'viewable_impressions', m.viewable_impressions,
          'clicks', m.clicks,
          'anonymous_served', m.anonymous_served,
          'total_served', m.served + m.anonymous_served,
          'click_through_rate',
            CASE
              WHEN m.viewable_impressions > 0
                THEN round(m.clicks::numeric * 100 / m.viewable_impressions, 2)
              ELSE 0
            END
        )
        ORDER BY m.served + m.anonymous_served DESC, m.campaign_name
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM metrics AS m;

  RETURN v_result;
END;
$function$;
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
    select event_date,sum(viewable_impressions) viewable_impressions,sum(clicks) clicks
    from catho_private.sponsor_campaign_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  ), comments as (
    select event_date,sum(impressions) impressions,sum(viewable_impressions) viewable_impressions
    from catho_private.feed_card_analytics_daily where event_date>=p_from::date and event_date<=p_to::date group by event_date
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_date',d.event_date,
    'topic_impressions',coalesce(t.impressions,0),'topic_viewable_impressions',coalesce(t.viewable_impressions,0),
    'sponsor_viewable_impressions',coalesce(s.viewable_impressions,0),
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


-- Consented, private recommendation personalisation (model 2026-11-20-v4).
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
  -- Personalisation is an independent explicit consent. Passive reading
  -- signals are used for recommendations only when Service improvement is
  -- separately enabled as well.
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

  -- The other analytics purposes are independent and remain off unless the
  -- corresponding unticked signup choice was explicitly selected.
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
    select d.campaign_id,d.event_date,d.viewable_impressions,d.clicks
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
      coalesce(sum(sd.viewable_impressions),0) viewable_impressions,
      coalesce(sum(sd.clicks),0) clicks
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id
    group by s.id,s.sponsor_name,s.status
    order by viewable_impressions desc,s.sponsor_name
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
REVOKE ALL ON FUNCTION public.set_my_personalization_consent(boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_personalization_consent(boolean, text) TO authenticated;
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
 
-- Optional analytics consent functions (account-only).
CREATE OR REPLACE FUNCTION public.get_user_analytics_consent(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_consent catho_private.user_analytics_consents%ROWTYPE;
  v_personalization_enabled boolean := false;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid account for analytics consent lookup' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    SELECT coalesce(pc.enabled, false) INTO v_personalization_enabled
    FROM (SELECT p_user_id AS user_id) AS actor
    LEFT JOIN catho_private.user_personalization_consents AS pc ON pc.user_id = actor.user_id;
  END IF;
  SELECT * INTO v_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'serviceImprovement', false,
      'sponsorMeasurement', false,
      'updatedAt', NULL,
      'version', 2,
      'exists', false,
      'personalizationEnabled', v_personalization_enabled
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', v_personalization_enabled
  );
END;
$function$;

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
     OR p_consent_version IS DISTINCT FROM 2
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

  IF v_previous_service IS DISTINCT FROM p_service_improvement
     AND pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
  END IF;

  IF p_sponsor_measurement IS NOT TRUE THEN
    DELETE FROM catho_private.sponsor_campaign_placement_receipts
    WHERE user_id = p_user_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', EXISTS (
      SELECT 1 FROM catho_private.user_personalization_consents AS pc
      WHERE pc.user_id = p_user_id AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
    )
  );
END;
$function$;

ALTER FUNCTION public.get_user_analytics_consent(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_user_analytics_consent(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_analytics_consent(uuid) TO service_role;
ALTER FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;



ALTER FUNCTION public.record_feed_analytics_events(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_feed_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_analytics_events(jsonb) TO authenticated;

ALTER FUNCTION public.record_feed_card_analytics_events(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_feed_card_analytics_events(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_feed_card_analytics_events(jsonb) TO authenticated;

ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) TO service_role;

ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

DROP FUNCTION IF EXISTS public.get_anonymous_sponsor_campaigns(text, text, text, integer);
DROP FUNCTION IF EXISTS public.record_anonymous_sponsor_campaign_event(text, uuid, text, uuid, text);

NOTIFY pgrst, 'reload schema';
-- End of CathoScroll application-schema and catalogue bootstrap.


-- FINAL ANALYTICS MODEL: NO ANONYMOUS MEASUREMENT AND NO SPONSOR DELIVERY COUNTERS.
-- Sponsor selection is still available to every visitor. Selection itself is not recorded.
CREATE OR REPLACE FUNCTION public.get_unmeasured_sponsor_campaigns(
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_slot integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR (p_category_slug IS NOT NULL AND p_category_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
     OR p_topic_id IS NULL
     OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid sponsor request' USING ERRCODE = '22023';
  END IF;

  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic
  WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY -ln(greatest(pg_catalog.random(), 0.000000000001)) / campaign.placement_weight::numeric ASC, campaign.id
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unmeasured_sponsor_campaigns(text, text, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(
  p_user_id uuid,
  p_session_id uuid,
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_slot integer;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor measurement request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT coalesce(consent.sponsor_measurement, false) INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF NOT coalesce(v_sponsor_measurement, false) THEN
    RAISE EXCEPTION 'Sponsor measurement consent required' USING ERRCODE = '42501';
  END IF;

  IF p_topic_id IS NULL OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Sponsor placement topic is required' USING ERRCODE = '22023';
  END IF;
  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND (campaign.daily_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today
      ), 0) < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS recent
        WHERE recent.user_id = p_user_id AND recent.campaign_id = campaign.id
          AND recent.event_type = 'viewable_impression'
          AND recent.received_at >= statement_timestamp() - interval '24 hours') < campaign.frequency_cap_per_user_24h
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS lifetime
        WHERE lifetime.user_id = p_user_id AND lifetime.campaign_id = campaign.id
          AND lifetime.event_type = 'viewable_impression') < campaign.frequency_cap_per_user_total
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY
      coalesce((SELECT sum(daily.viewable_impressions)::numeric
        FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
          AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today), 0)
        / campaign.placement_weight::numeric ASC,
      pg_catalog.random(), campaign.id
    LIMIT 1 FOR UPDATE OF campaign SKIP LOCKED;

    IF NOT FOUND THEN EXIT; END IF;

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'sponsor_logo_url', NULL,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored'
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_sponsor_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_sponsor_id IS NULL OR p_from IS NULL OR p_to IS NULL
     OR p_to <= p_from OR p_to - p_from > interval '180 days' THEN
    RAISE EXCEPTION 'Invalid sponsor analytics range' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;

  WITH campaigns AS (
    SELECT id, campaign_name, status
    FROM public.sponsor_campaigns WHERE sponsor_id = p_sponsor_id
  ),
  metrics AS (
    SELECT coalesce(sum(d.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(d.clicks), 0) AS clicks,
      count(DISTINCT d.campaign_id) FILTER (WHERE d.viewable_impressions > 0) AS active_campaigns
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date >= p_from::date AND d.event_date <= p_to::date
  ),
  series AS (
    SELECT d.event_date,
      coalesce(sum(d.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(d.clicks), 0) AS clicks
    FROM catho_private.sponsor_campaign_daily AS d
    JOIN campaigns AS c ON c.id = d.campaign_id
    WHERE d.event_date >= p_from::date AND d.event_date <= p_to::date
    GROUP BY d.event_date ORDER BY d.event_date
  )
  SELECT jsonb_build_object(
    'sponsor_id', p_sponsor_id,
    'totals', (SELECT to_jsonb(metrics) FROM metrics),
    'campaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.campaign_name, 'status', c.status)), '[]'::jsonb) FROM campaigns AS c),
    'series', (SELECT coalesce(jsonb_agg(to_jsonb(series)), '[]'::jsonb) FROM series)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_analytics(uuid, uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_sponsor_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id
      AND membership.user_id = p_actor_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH campaigns AS (
    SELECT campaign.id, campaign.campaign_name, campaign.status
    FROM public.sponsor_campaigns AS campaign
    WHERE campaign.sponsor_id = p_sponsor_id
  ),
  metrics AS (
    SELECT campaign.id AS campaign_id, campaign.campaign_name, campaign.status,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.clicks), 0) AS clicks
    FROM campaigns AS campaign
    LEFT JOIN catho_private.sponsor_campaign_daily AS daily
      ON daily.campaign_id = campaign.id AND daily.event_date BETWEEN p_from AND p_to
    GROUP BY campaign.id, campaign.campaign_name, campaign.status
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', metrics.campaign_id,
      'campaign_name', metrics.campaign_name,
      'status', metrics.status,
      'viewable_impressions', metrics.viewable_impressions,
      'clicks', metrics.clicks,
      'click_through_rate', CASE WHEN metrics.viewable_impressions > 0
        THEN round(metrics.clicks::numeric * 100 / metrics.viewable_impressions, 2) ELSE 0 END
    ) ORDER BY metrics.viewable_impressions DESC, metrics.campaign_name), '[]'::jsonb)
  ) INTO v_result
  FROM metrics;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_campaign_analytics(uuid, uuid, date, date) TO service_role;

-- Stop the scheduled job before removing its function or tables.
DO $anonymous_cron_cleanup$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
      USING 'cathoscroll-anonymous-analytics-prune';
  END IF;
END;
$anonymous_cron_cleanup$;

-- Remove all legacy anonymous analytics storage and entry points.
DROP FUNCTION IF EXISTS public.get_admin_anonymous_analytics(uuid, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.record_anonymous_feed_analytics(jsonb);
DROP FUNCTION IF EXISTS catho_private.prune_anonymous_analytics();
DROP TABLE IF EXISTS catho_private.anonymous_sponsor_session_frequency;
DROP TABLE IF EXISTS catho_private.anonymous_sponsor_events;
DROP TABLE IF EXISTS catho_private.anonymous_sponsor_campaign_daily;
DROP TABLE IF EXISTS catho_private.anonymous_feed_event_receipts;
DROP TABLE IF EXISTS catho_private.anonymous_feed_analytics_daily;

-- No delivery counters or served events are retained. Frequency is measured only
-- from viewable events for users who opted into Sponsor measurement.

NOTIFY pgrst, 'reload schema';


-- Corrected consented sponsor event ingestion. A delivery is never recorded:
-- only an opted-in viewable impression or click creates an event row.
CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(
  p_user_id uuid,
  p_campaign_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_inserted integer := 0;
  v_sponsor_consent boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_event_type IS NULL OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT consent.sponsor_measurement INTO v_sponsor_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF coalesce(v_sponsor_consent, false) IS NOT TRUE THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'approved'
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND sponsor.status IN ('active', 'scheduled')
      AND sponsor.payment_status IN ('received', 'not_required')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
  ) THEN
    RAISE EXCEPTION 'Sponsor campaign is not currently eligible' USING ERRCODE = '42501';
  END IF;

  IF p_event_type = 'click' AND NOT EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS viewed
    WHERE viewed.user_id = p_user_id AND viewed.campaign_id = p_campaign_id
      AND viewed.session_id = p_session_id AND viewed.event_type = 'viewable_impression'
  ) THEN
    RAISE EXCEPTION 'Sponsor campaign must be viewable before a click is recorded' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
      AND existing.session_id = p_session_id AND existing.event_type = p_event_type
  ) THEN
    RETURN true;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_events
    (campaign_id, event_id, user_id, session_id, event_type, received_at)
  VALUES (p_campaign_id, p_event_id, p_user_id, p_session_id, p_event_type, statement_timestamp())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
      WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
        AND existing.session_id = p_session_id AND existing.event_type = p_event_type
    );
  END IF;

  INSERT INTO catho_private.sponsor_campaign_daily
    (event_date, campaign_id, viewable_impressions, clicks, updated_at)
  VALUES (
    v_today,
    p_campaign_id,
    CASE WHEN p_event_type = 'viewable_impression' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
    statement_timestamp()
  )
  ON CONFLICT (event_date, campaign_id) DO UPDATE
  SET viewable_impressions = catho_private.sponsor_campaign_daily.viewable_impressions + EXCLUDED.viewable_impressions,
      clicks = catho_private.sponsor_campaign_daily.clicks + EXCLUDED.clicks,
      updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text) TO service_role;

-- The delivery selectors intentionally do not enforce impression caps because
-- no delivery counts are collected. Consented frequency limits are enforced
-- from opted-in viewable-impression events by the weighted selector.

DO $anonymous_cron_cleanup_final$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
      USING 'cathoscroll-anonymous-analytics-prune';
  END IF;
END;
$anonymous_cron_cleanup_final$;

NOTIFY pgrst, 'reload schema';


CREATE OR REPLACE FUNCTION public.get_admin_sponsor_campaign_analytics(
  p_actor_user_id uuid,
  p_from date DEFAULT ((timezone('UTC'::text, statement_timestamp()))::date - 29),
  p_to date DEFAULT (timezone('UTC'::text, statement_timestamp()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admin WHERE admin.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 179 THEN
    RAISE EXCEPTION 'Invalid sponsor analytics date range' USING ERRCODE = '22023';
  END IF;

  WITH metrics AS (
    SELECT campaign.id AS campaign_id,
      coalesce(sum(daily.viewable_impressions), 0) AS viewable_impressions,
      coalesce(sum(daily.clicks), 0) AS clicks
    FROM public.sponsor_campaigns AS campaign
    LEFT JOIN catho_private.sponsor_campaign_daily AS daily
      ON daily.campaign_id = campaign.id AND daily.event_date BETWEEN p_from AND p_to
    GROUP BY campaign.id
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'campaigns', coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', metrics.campaign_id,
      'viewable_impressions', metrics.viewable_impressions,
      'clicks', metrics.clicks,
      'click_through_rate', CASE WHEN metrics.viewable_impressions > 0
        THEN round(metrics.clicks::numeric * 100 / metrics.viewable_impressions, 2)
        ELSE 0 END
    ) ORDER BY metrics.viewable_impressions DESC, metrics.campaign_id), '[]'::jsonb)
  ) INTO v_result
  FROM metrics;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_campaign_analytics(uuid, date, date) TO service_role;

-- Permanently remove all sponsor delivery counters from the schema.
ALTER TABLE public.sponsor_campaigns DROP COLUMN IF EXISTS served_count;
ALTER TABLE catho_private.sponsor_campaign_daily DROP COLUMN IF EXISTS served_count;
NOTIFY pgrst, 'reload schema';

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
    or p_to > statement_timestamp()+interval '1 day' then
    raise exception 'invalid analytics range' using errcode='22023';
  end if;
  with topic_daily as (
    select d.entity_id,d.event_date,d.impressions,d.viewable_impressions,d.active_duration_ms,d.skips,d.completions,d.return_visits
    from catho_private.feed_analytics_daily d where d.event_date >= p_from::date and d.event_date <= p_to::date
  ), sponsor_daily as (
    select d.campaign_id,d.event_date,d.viewable_impressions,d.clicks
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
      coalesce(sum(sd.viewable_impressions),0) viewable_impressions,
      coalesce(sum(sd.clicks),0) clicks
    from public.sponsors s left join public.sponsor_campaigns sc on sc.sponsor_id=s.id
    left join sponsor_daily sd on sd.campaign_id=sc.id
    group by s.id,s.sponsor_name,s.status
    order by viewable_impressions desc,s.sponsor_name
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
ALTER FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_overview(uuid, timestamp with time zone, timestamp with time zone) TO service_role;
DROP FUNCTION IF EXISTS public.get_admin_analytics_overview(timestamp with time zone, timestamp with time zone);

NOTIFY pgrst, 'reload schema';

DROP FUNCTION IF EXISTS public.get_admin_sponsor_analytics(uuid, timestamptz, timestamptz);

CREATE TABLE IF NOT EXISTS catho_private.sponsor_campaign_placement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.sponsor_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  viewable_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_campaign_placement_receipts_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sponsor_campaign_placement_receipts_expiry_idx
  ON catho_private.sponsor_campaign_placement_receipts(expires_at);
CREATE INDEX IF NOT EXISTS sponsor_campaign_placement_receipts_user_idx
  ON catho_private.sponsor_campaign_placement_receipts(user_id, campaign_id);
ALTER TABLE catho_private.sponsor_campaign_placement_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_campaign_placement_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catho_private.prune_sponsor_campaign_events(
  p_before timestamptz DEFAULT (statement_timestamp() - interval '180 days'),
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
  v_receipts_deleted integer := 0;
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
        campaign.ends_on < (p_before AT TIME ZONE 'UTC')::date
        OR sponsor.status = 'completed'
        OR (sponsor.ends_on IS NOT NULL AND sponsor.ends_on < (p_before AT TIME ZONE 'UTC')::date)
      )
    ORDER BY campaign.ends_on, campaign.id
    LIMIT p_limit
  )
  UPDATE public.sponsor_campaigns AS campaign
  SET status = 'completed', updated_at = statement_timestamp()
  FROM expired_campaigns
  WHERE campaign.id = expired_campaigns.id;

  WITH expired_events AS (
    SELECT event.ctid FROM catho_private.sponsor_campaign_events AS event
    WHERE event.received_at < p_before
    ORDER BY event.received_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_events AS event
  USING expired_events WHERE event.ctid = expired_events.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired_receipts AS (
    SELECT receipt.ctid FROM catho_private.sponsor_campaign_placement_receipts AS receipt
    WHERE receipt.expires_at <= statement_timestamp()
    ORDER BY receipt.expires_at
    LIMIT p_limit
  )
  DELETE FROM catho_private.sponsor_campaign_placement_receipts AS receipt
  USING expired_receipts WHERE receipt.ctid = expired_receipts.ctid;
  GET DIAGNOSTICS v_receipts_deleted = ROW_COUNT;

  RETURN v_deleted + v_receipts_deleted;
END;
$function$;
ALTER FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catho_private.prune_sponsor_campaign_events(timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_weighted_sponsor_campaigns(
  p_user_id uuid,
  p_session_id uuid,
  p_category_slug text DEFAULT NULL::text,
  p_topic_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_campaign record;
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_campaigns jsonb := '[]'::jsonb;
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_topic_category_slug text;
  v_sponsor_measurement boolean := false;
  v_receipt uuid;
  v_slot integer;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor measurement request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT coalesce(consent.sponsor_measurement, false) INTO v_sponsor_measurement
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF NOT coalesce(v_sponsor_measurement, false) THEN
    RAISE EXCEPTION 'Sponsor measurement consent required' USING ERRCODE = '42501';
  END IF;
  IF p_topic_id IS NULL OR p_topic_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR (p_category_slug IS NOT NULL AND p_category_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'Invalid sponsor placement topic' USING ERRCODE = '22023';
  END IF;

  SELECT topic.category_slug INTO v_topic_category_slug
  FROM public.topics AS topic WHERE topic.id = p_topic_id AND topic.is_published;
  IF NOT FOUND OR (p_category_slug IS NOT NULL AND p_category_slug <> v_topic_category_slug) THEN
    RAISE EXCEPTION 'Sponsor placement topic is unavailable' USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN 1..p_limit LOOP
    SELECT campaign.id, sponsor.sponsor_name, campaign.headline, campaign.body,
      campaign.image_url, campaign.destination_url, campaign.cta_label, campaign.campaign_name
    INTO v_campaign
    FROM public.sponsor_campaigns AS campaign
    JOIN public.sponsors AS sponsor ON sponsor.id = campaign.sponsor_id
    WHERE campaign.status = 'approved'
      AND sponsor.status IN ('active', 'scheduled')
      AND (sponsor.starts_on IS NULL OR sponsor.starts_on <= v_today)
      AND (sponsor.ends_on IS NULL OR sponsor.ends_on >= v_today)
      AND sponsor.payment_status IN ('received', 'not_required')
      AND campaign.starts_on <= v_today AND campaign.ends_on >= v_today
      AND (cardinality(campaign.target_category_slugs) = 0 OR v_topic_category_slug = ANY(campaign.target_category_slugs))
      AND (cardinality(campaign.target_topic_ids) = 0 OR p_topic_id = ANY(campaign.target_topic_ids))
      AND (campaign.daily_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id AND daily.event_date = v_today
      ), 0) < campaign.daily_impression_cap)
      AND (campaign.total_impression_cap IS NULL OR coalesce((
        SELECT sum(daily.viewable_impressions) FROM catho_private.sponsor_campaign_daily AS daily
        WHERE daily.campaign_id = campaign.id
      ), 0) < campaign.total_impression_cap)
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS recent
        WHERE recent.user_id = p_user_id AND recent.campaign_id = campaign.id
          AND recent.event_type = 'viewable_impression'
          AND recent.received_at >= statement_timestamp() - interval '24 hours') < campaign.frequency_cap_per_user_24h
      AND (SELECT count(*) FROM catho_private.sponsor_campaign_events AS lifetime
        WHERE lifetime.user_id = p_user_id AND lifetime.campaign_id = campaign.id
          AND lifetime.event_type = 'viewable_impression') < campaign.frequency_cap_per_user_total
      AND NOT campaign.id = ANY(v_campaign_ids)
    ORDER BY
      -ln(greatest(pg_catalog.random(), 0.000000000001))
        / (campaign.placement_weight::numeric / (1 + coalesce((
          SELECT sum(daily.viewable_impressions)
          FROM catho_private.sponsor_campaign_daily AS daily
          WHERE daily.campaign_id = campaign.id
            AND daily.event_date >= v_today - 29 AND daily.event_date <= v_today
        ), 0))) ASC,
      campaign.id
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

    v_receipt := pg_catalog.gen_random_uuid();
    INSERT INTO catho_private.sponsor_campaign_placement_receipts
      (id, campaign_id, user_id, session_id, expires_at)
    VALUES (v_receipt, v_campaign.id, p_user_id, p_session_id,
      pg_catalog.statement_timestamp() + interval '7 days');

    v_campaign_ids := pg_catalog.array_append(v_campaign_ids, v_campaign.id);
    v_campaigns := v_campaigns || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'campaign_id', v_campaign.id,
      'sponsor_name', v_campaign.sponsor_name,
      'campaign_name', v_campaign.campaign_name,
      'headline', v_campaign.headline,
      'body', v_campaign.body,
      'image_url', v_campaign.image_url,
      'destination_url', v_campaign.destination_url,
      'cta_label', v_campaign.cta_label,
      'disclosure', 'Sponsored',
      'measurement_receipt', v_receipt
    ));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('campaigns', v_campaigns, 'generated_at', statement_timestamp());
END;
$function$;
ALTER FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weighted_sponsor_campaigns(uuid, uuid, text, text, integer) TO service_role;

DROP FUNCTION IF EXISTS public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_sponsor_campaign_event(
  p_user_id uuid,
  p_campaign_id uuid,
  p_event_id uuid,
  p_session_id uuid,
  p_placement_receipt uuid,
  p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.timezone('UTC', statement_timestamp()))::date;
  v_inserted integer := 0;
  v_sponsor_consent boolean := false;
  v_receipt catho_private.sponsor_campaign_placement_receipts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_campaign_id IS NULL OR p_event_id IS NULL OR p_session_id IS NULL
     OR p_placement_receipt IS NULL OR p_event_type IS NULL
     OR p_event_type NOT IN ('viewable_impression', 'click')
     OR NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid sponsor campaign event' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM auth.users AS account WHERE account.id = p_user_id FOR KEY SHARE;
  SELECT consent.sponsor_measurement INTO v_sponsor_consent
  FROM catho_private.user_analytics_consents AS consent
  WHERE consent.user_id = p_user_id FOR SHARE;
  IF coalesce(v_sponsor_consent, false) IS NOT TRUE THEN RETURN false; END IF;

  SELECT * INTO v_receipt
  FROM catho_private.sponsor_campaign_placement_receipts AS receipt
  WHERE receipt.id = p_placement_receipt
    AND receipt.campaign_id = p_campaign_id
    AND receipt.user_id = p_user_id
    AND receipt.session_id = p_session_id
    AND receipt.expires_at > pg_catalog.statement_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sponsor placement receipt is invalid or expired' USING ERRCODE = '42501';
  END IF;

  IF p_event_type = 'click' AND v_receipt.viewable_at IS NULL THEN
    RAISE EXCEPTION 'Sponsor campaign must be viewable before a click is recorded' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
    WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
      AND existing.session_id = p_session_id AND existing.event_type = p_event_type
  ) THEN
    IF p_event_type = 'viewable_impression' THEN
      UPDATE catho_private.sponsor_campaign_placement_receipts
      SET viewable_at = coalesce(viewable_at, pg_catalog.statement_timestamp())
      WHERE id = p_placement_receipt;
    END IF;
    RETURN true;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_events
    (campaign_id, event_id, user_id, session_id, event_type, received_at)
  VALUES (p_campaign_id, p_event_id, p_user_id, p_session_id, p_event_type, pg_catalog.statement_timestamp())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN EXISTS (
      SELECT 1 FROM catho_private.sponsor_campaign_events AS existing
      WHERE existing.user_id = p_user_id AND existing.campaign_id = p_campaign_id
        AND existing.session_id = p_session_id AND existing.event_type = p_event_type
    );
  END IF;

  IF p_event_type = 'viewable_impression' THEN
    UPDATE catho_private.sponsor_campaign_placement_receipts
    SET viewable_at = pg_catalog.statement_timestamp()
    WHERE id = p_placement_receipt;
  END IF;

  INSERT INTO catho_private.sponsor_campaign_daily
    (event_date, campaign_id, viewable_impressions, clicks, updated_at)
  VALUES (
    v_today, p_campaign_id,
    CASE WHEN p_event_type = 'viewable_impression' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
    pg_catalog.statement_timestamp()
  )
  ON CONFLICT (event_date, campaign_id) DO UPDATE
  SET viewable_impressions = catho_private.sponsor_campaign_daily.viewable_impressions + EXCLUDED.viewable_impressions,
      clicks = catho_private.sponsor_campaign_daily.clicks + EXCLUDED.clicks,
      updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sponsor_campaign_event(uuid, uuid, uuid, uuid, uuid, text) TO service_role;

-- Remove the former per-user served-frequency table. Frequency limits are
-- derived only from the opted-in sponsor viewability event ledger.
DROP TABLE IF EXISTS catho_private.sponsor_campaign_user_frequency;


-- Withdrawal cleanup: remove account-linked event records for a withdrawn
-- purpose, then rebuild the affected daily aggregates from the remaining
-- currently-consented event ledger. Historical aggregates outside the raw
-- retention window remain non-identifying campaign/content totals.

CREATE OR REPLACE FUNCTION catho_private.purge_user_service_improvement_events(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_deleted integer := 0;
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT min(event_date), max(event_date)
  INTO v_from, v_to
  FROM (
    SELECT (event.received_at AT TIME ZONE 'UTC')::date AS event_date
    FROM catho_private.feed_analytics_events AS event
    WHERE event.user_id = p_user_id
    UNION ALL
    SELECT (event.received_at AT TIME ZONE 'UTC')::date AS event_date
    FROM catho_private.feed_card_analytics_events AS event
    WHERE event.user_id = p_user_id
  ) AS affected_dates;

  DELETE FROM catho_private.feed_analytics_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM catho_private.feed_card_analytics_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_deleted := v_deleted + v_rows;

  DELETE FROM catho_private.feed_analytics_event_limits WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_card_analytics_event_limits WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_analytics_daily_viewers WHERE user_id = p_user_id;
  DELETE FROM catho_private.feed_card_analytics_daily_viewers WHERE user_id = p_user_id;

  IF pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
    IF pg_catalog.to_regprocedure('catho_private.refresh_user_interest_profile(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT catho_private.refresh_user_interest_profile($1)' USING p_user_id;
    END IF;
  END IF;

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN v_deleted;
  END IF;

  DELETE FROM catho_private.feed_analytics_daily
  WHERE event_date BETWEEN v_from AND v_to;

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
    pg_catalog.statement_timestamp()
  FROM catho_private.feed_analytics_events AS event
  WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.entity_id;

  DELETE FROM catho_private.feed_analytics_daily_viewers
  WHERE event_date BETWEEN v_from AND v_to;

  INSERT INTO catho_private.feed_analytics_daily_viewers (event_date, entity_id, user_id)
  SELECT DISTINCT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.entity_id,
    event.user_id
  FROM catho_private.feed_analytics_events AS event
  WHERE event.event_type = 'viewable_impression'
    AND (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  ON CONFLICT DO NOTHING;

  DELETE FROM catho_private.feed_card_analytics_daily
  WHERE event_date BETWEEN v_from AND v_to;

  DELETE FROM catho_private.feed_card_analytics_daily_viewers
  WHERE event_date BETWEEN v_from AND v_to;

  INSERT INTO catho_private.feed_card_analytics_daily_viewers (
    event_date, card_type, card_id, user_id
  )
  SELECT DISTINCT
    (event.received_at AT TIME ZONE 'UTC')::date,
    event.card_type,
    event.card_id,
    event.user_id
  FROM catho_private.feed_card_analytics_events AS event
  WHERE event.event_type IN ('impression', 'viewable_impression')
    AND (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
  ON CONFLICT DO NOTHING;

  WITH event_totals AS (
    SELECT
      (event.received_at AT TIME ZONE 'UTC')::date AS event_date,
      event.card_type,
      event.card_id,
      count(*) FILTER (WHERE event.event_type = 'impression') AS impressions,
      count(*) FILTER (WHERE event.event_type = 'viewable_impression') AS viewable_impressions,
      coalesce(sum(event.duration_ms) FILTER (WHERE event.event_type = 'active_duration'), 0) AS active_duration_ms,
      count(*) FILTER (WHERE event.event_type = 'skip') AS skips,
      count(*) FILTER (WHERE event.event_type = 'completion') AS completions,
      count(*) FILTER (WHERE event.event_type = 'open') AS opens
    FROM catho_private.feed_card_analytics_events AS event
    WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
    GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.card_type, event.card_id
  ),
  viewer_totals AS (
    SELECT event_date, card_type, card_id, count(*) AS unique_viewers
    FROM catho_private.feed_card_analytics_daily_viewers
    WHERE event_date BETWEEN v_from AND v_to
    GROUP BY event_date, card_type, card_id
  )
  INSERT INTO catho_private.feed_card_analytics_daily (
    event_date, card_type, card_id, impressions, viewable_impressions,
    active_duration_ms, skips, completions, opens, unique_viewers, refreshed_at
  )
  SELECT
    event_totals.event_date,
    event_totals.card_type,
    event_totals.card_id,
    event_totals.impressions,
    event_totals.viewable_impressions,
    event_totals.active_duration_ms,
    event_totals.skips,
    event_totals.completions,
    event_totals.opens,
    coalesce(viewer_totals.unique_viewers, 0),
    pg_catalog.statement_timestamp()
  FROM event_totals
  LEFT JOIN viewer_totals USING (event_date, card_type, card_id);

  RETURN v_deleted;
END;
$function$;
ALTER FUNCTION catho_private.purge_user_service_improvement_events(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.purge_user_service_improvement_events(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catho_private.purge_user_sponsor_measurement_events(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_from date;
  v_to date;
  v_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT min((event.received_at AT TIME ZONE 'UTC')::date),
         max((event.received_at AT TIME ZONE 'UTC')::date)
  INTO v_from, v_to
  FROM catho_private.sponsor_campaign_events AS event
  WHERE event.user_id = p_user_id;

  DELETE FROM catho_private.sponsor_campaign_events WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM catho_private.sponsor_campaign_placement_receipts WHERE user_id = p_user_id;

  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    DELETE FROM catho_private.sponsor_campaign_daily
    WHERE event_date BETWEEN v_from AND v_to;

    INSERT INTO catho_private.sponsor_campaign_daily (
      event_date, campaign_id, viewable_impressions, clicks, updated_at
    )
    SELECT
      (event.received_at AT TIME ZONE 'UTC')::date,
      event.campaign_id,
      count(*) FILTER (WHERE event.event_type = 'viewable_impression'),
      count(*) FILTER (WHERE event.event_type = 'click'),
      pg_catalog.statement_timestamp()
    FROM catho_private.sponsor_campaign_events AS event
    WHERE (event.received_at AT TIME ZONE 'UTC')::date BETWEEN v_from AND v_to
    GROUP BY (event.received_at AT TIME ZONE 'UTC')::date, event.campaign_id;
  END IF;

  RETURN v_deleted;
END;
$function$;
ALTER FUNCTION catho_private.purge_user_sponsor_measurement_events(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION catho_private.purge_user_sponsor_measurement_events(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
     OR p_consent_version IS DISTINCT FROM 2
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
    IF p_service_improvement IS NOT TRUE THEN
      PERFORM catho_private.purge_user_service_improvement_events(p_user_id);
    END IF;
    IF p_sponsor_measurement IS NOT TRUE THEN
      PERFORM catho_private.purge_user_sponsor_measurement_events(p_user_id);
    END IF;
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

  IF v_previous_service IS DISTINCT FROM p_service_improvement
     AND pg_catalog.to_regclass('catho_private.user_personalization_consents') IS NOT NULL THEN
    UPDATE catho_private.user_personalization_consents
    SET profile_refreshed_at = NULL
    WHERE user_id = p_user_id AND enabled = true;
  END IF;

  IF p_service_improvement IS NOT TRUE THEN
    PERFORM catho_private.purge_user_service_improvement_events(p_user_id);
  END IF;

  IF p_sponsor_measurement IS NOT TRUE THEN
    PERFORM catho_private.purge_user_sponsor_measurement_events(p_user_id);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'serviceImprovement', v_consent.service_improvement,
    'sponsorMeasurement', v_consent.sponsor_measurement,
    'updatedAt', v_consent.updated_at,
    'version', v_consent.consent_version,
    'exists', true,
    'personalizationEnabled', EXISTS (
      SELECT 1 FROM catho_private.user_personalization_consents AS pc
      WHERE pc.user_id = p_user_id AND pc.enabled = true
      AND pc.consent_version = '2026-11-21-v6'
    )
  );
END;
$function$;
ALTER FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_analytics_consent(uuid, boolean, boolean, integer) TO service_role;

DO $consent_cleanup$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN
    SELECT user_id
    FROM catho_private.user_analytics_consents
    WHERE service_improvement IS NOT TRUE OR sponsor_measurement IS NOT TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM catho_private.user_analytics_consents
      WHERE user_id = v_user.user_id AND service_improvement IS TRUE
    ) THEN
      PERFORM catho_private.purge_user_service_improvement_events(v_user.user_id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM catho_private.user_analytics_consents
      WHERE user_id = v_user.user_id AND sponsor_measurement IS TRUE
    ) THEN
      PERFORM catho_private.purge_user_sponsor_measurement_events(v_user.user_id);
    END IF;
  END LOOP;
END;
$consent_cleanup$;

NOTIFY pgrst, 'reload schema';
