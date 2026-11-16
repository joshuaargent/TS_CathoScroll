-- Offline activity batching and account-scoped write protection.
-- Apply after the original offline activity tables and RPCs exist.

ALTER TABLE catho_private.user_action_limits
  ADD COLUMN IF NOT EXISTS offline_sync_window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_sync_count integer NOT NULL DEFAULT 0;

ALTER TABLE catho_private.user_action_limits
  DROP CONSTRAINT IF EXISTS user_action_limits_offline_sync_count_check;
ALTER TABLE catho_private.user_action_limits
  ADD CONSTRAINT user_action_limits_offline_sync_count_check
  CHECK (offline_sync_count >= 0);

CREATE OR REPLACE FUNCTION public.offline_apply_activity_v2(
  p_user uuid,
  p_operation uuid,
  p_device uuid,
  p_sequence text,
  p_acknowledged text,
  p_kind text,
  p_topic text,
  p_value boolean,
  p_completed_at timestamptz DEFAULT NULL
)
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
  IF NOT FOUND AND EXISTS (
    SELECT 1 FROM catho_private.activity_receipt_sequences
    WHERE user_id = actor AND operation_id = p_operation
  ) THEN RAISE EXCEPTION 'Activity operation ID was reused'; END IF;

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

CREATE OR REPLACE FUNCTION public.offline_apply_activity_batch(
  p_user uuid,
  p_operations jsonb
)
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

REVOKE ALL ON FUNCTION public.offline_apply_activity_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offline_apply_activity_batch(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
