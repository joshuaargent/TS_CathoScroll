ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(slug, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(answer, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(explanation, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(catechism_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(scripture_reference, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(scripture_text, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS topics_search_vector_idx
  ON public.topics
  USING GIN (search_vector);

CREATE OR REPLACE FUNCTION public.search_published_topics(
  search_query text,
  result_limit integer DEFAULT 30
)
RETURNS TABLE (
  id text,
  slug text,
  category_slug text,
  category_name text,
  question text,
  answer text,
  explanation text,
  catechism_paragraphs text[],
  catechism_text text,
  scripture_reference text,
  scripture_text text,
  search_score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH parsed_query AS (
    SELECT websearch_to_tsquery('english', coalesce(search_query, '')) AS query
  ),
  ranked_topics AS (
    SELECT
      topic.id,
      topic.slug,
      category.slug AS category_slug,
      category.name AS category_name,
      topic.question,
      topic.answer,
      topic.explanation,
      topic.catechism_paragraphs,
      topic.catechism_text,
      topic.scripture_reference,
      topic.scripture_text,
      (
        ts_rank(topic.search_vector, parsed_query.query) +
        CASE
          WHEN to_tsvector('english', coalesce(category.name, '')) @@ parsed_query.query
          THEN 0.5 * ts_rank(
            to_tsvector('english', coalesce(category.name, '')),
            parsed_query.query
          )
          ELSE 0
        END
      )::real AS search_score
    FROM public.topics AS topic
    INNER JOIN public.categories AS category
      ON category.slug = topic.category_slug
    CROSS JOIN parsed_query
    WHERE
      topic.is_published = true
      AND category.is_published = true
      AND numnode(parsed_query.query) > 0
      AND (
        topic.search_vector @@ parsed_query.query
        OR to_tsvector('english', coalesce(category.name, '')) @@ parsed_query.query
      )
  )
  SELECT
    ranked_topics.id,
    ranked_topics.slug,
    ranked_topics.category_slug,
    ranked_topics.category_name,
    ranked_topics.question,
    ranked_topics.answer,
    ranked_topics.explanation,
    ranked_topics.catechism_paragraphs,
    ranked_topics.catechism_text,
    ranked_topics.scripture_reference,
    ranked_topics.scripture_text,
    ranked_topics.search_score
  FROM ranked_topics
  ORDER BY ranked_topics.search_score DESC, ranked_topics.question ASC, ranked_topics.id ASC
  LIMIT least(greatest(coalesce(result_limit, 30), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.search_published_topics(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_published_topics(text, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
