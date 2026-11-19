-- Public, non-personalised general feed.
-- Uses the same category-balanced scheduling as the opt-out branch of
-- get_my_recommendation_page, without reading account activity or requiring auth.
CREATE OR REPLACE FUNCTION public.get_public_general_topic_page(
  p_session_id uuid,
  feed_cursor jsonb DEFAULT NULL,
  page_limit integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  state jsonb;
  categories jsonb;
  chosen record;
  items jsonb := '[]'::jsonb;
  last_category text;
  streak integer;
  item_count integer := 0;
  initial_page boolean := feed_cursor IS NULL OR feed_cursor = 'null'::jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'A feed session is required' USING ERRCODE = '22023';
  END IF;
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 50 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF initial_page THEN
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
    state := jsonb_build_object(
      'sessionId', p_session_id,
      'categories', categories,
      'last', NULL,
      'streak', 0
    );
  ELSE
    state := feed_cursor;
  END IF;

  IF jsonb_typeof(state) IS DISTINCT FROM 'object'
     OR NOT (state ?& ARRAY['sessionId', 'categories', 'last', 'streak'])
     OR octet_length(state::text) > 65536
     OR state->>'sessionId' IS DISTINCT FROM p_session_id::text
     OR jsonb_typeof(state->'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(state->'categories') > 200
     OR jsonb_typeof(state->'streak') IS DISTINCT FROM 'number'
     OR coalesce(state->>'streak', '') !~ '^[0-2]$'
     OR (
       state->'last' <> 'null'::jsonb AND (
         jsonb_typeof(state->'last') IS DISTINCT FROM 'string'
         OR state->>'last' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         OR length(state->>'last') > 100
       )
     ) THEN
    RAISE EXCEPTION 'Invalid general-feed cursor' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(state->'categories') a(entry)
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR NOT (entry ?& ARRAY['slug', 'weight', 'served', 'order', 'id'])
       OR jsonb_typeof(entry->'slug') IS DISTINCT FROM 'string'
       OR entry->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR jsonb_typeof(entry->'weight') IS DISTINCT FROM 'number'
       OR entry->>'weight' <> '1'
       OR jsonb_typeof(entry->'served') IS DISTINCT FROM 'number'
       OR coalesce(entry->>'served', '') !~ '^[0-9]{1,9}$'
       OR (entry->'order' = 'null'::jsonb) IS DISTINCT FROM (entry->'id' = 'null'::jsonb)
       OR (entry->'order' <> 'null'::jsonb AND (
         jsonb_typeof(entry->'order') IS DISTINCT FROM 'number'
         OR coalesce(entry->>'order', '') !~ '^-?[0-9]{1,10}$'
         OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'string'
         OR coalesce(entry->>'id', '') !~ '^[a-zA-Z0-9-]{1,100}$'
       ))
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(state->'categories') a(entry)
    GROUP BY entry->>'slug'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid general-feed cursor' USING ERRCODE = '22023';
  END IF;

  categories := state->'categories';
  last_category := state->>'last';
  streak := (state->>'streak')::integer;

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
        AND (t.order_index, t.id) > (
          coalesce((a.entry->>'order')::integer, -2147483648),
          coalesce(a.entry->>'id', '')
        )
      ORDER BY t.order_index, t.id
      LIMIT 1
    ) t
    ORDER BY
      CASE WHEN streak >= 2 AND c.slug = last_category THEN 1 ELSE 0 END,
      (a.entry->>'served')::numeric,
      c.slug
    LIMIT 1;

    IF NOT FOUND THEN EXIT; END IF;

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
        'sessionId', p_session_id,
        'categories', categories,
        'last', last_category,
        'streak', streak
      )
      ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_general_topic_page(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_general_topic_page(uuid, jsonb, integer) TO anon, authenticated;
