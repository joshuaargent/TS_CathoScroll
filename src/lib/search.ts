import type { Topic } from '@/types';

export interface TopicSearchResult {
  topic: Topic;
  score: number;
}

export function topicSearchResultFromDatabase(value: unknown): TopicSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid topic search result.');
  }
  const row = value as Record<string, unknown>;
  const fields = [
    'id',
    'slug',
    'category_name',
    'question',
    'answer',
    'explanation',
    'catechism_text',
    'scripture_reference',
    'scripture_text',
  ] as const;
  if (
    fields.some((field) => typeof row[field] !== 'string') ||
    typeof row.search_score !== 'number' ||
    !Number.isFinite(row.search_score) ||
    (row.catechism_paragraphs !== null &&
      (!Array.isArray(row.catechism_paragraphs) ||
        row.catechism_paragraphs.some((paragraph) => typeof paragraph !== 'string')))
  ) {
    throw new Error('Invalid topic search result.');
  }
  const text = (field: (typeof fields)[number]) => {
    const result = row[field];
    if (typeof result !== 'string') throw new Error('Invalid topic search result.');
    return result;
  };
  return {
    topic: {
      id: text('id'),
      slug: text('slug'),
      category: text('category_name'),
      question: text('question'),
      answer: text('answer'),
      explanation: text('explanation'),
      catechism: {
        paragraphs: Array.isArray(row.catechism_paragraphs) ? row.catechism_paragraphs : [],
        text: text('catechism_text'),
      },
      scripture: {
        reference: text('scripture_reference'),
        text: text('scripture_text'),
      },
    },
    score: row.search_score,
  };
}

/**
 * Ranks in-memory topics using weighted phrase matches, per-term matches, and
 * occurrence frequency. Question/category matches intentionally outweigh
 * matches in supporting text.
 *
 * AQA-style pseudocode:
 * FUNCTION searchTopics(query)
 *   q ← LOWERCASE(TRIM(query))
 *   IF q = "" THEN RETURN []
 *   terms ← SPLIT q ON whitespace
 *   results ← empty list
 *   FOR EACH topic IN topics
 *     score ← 0
 *     ADD phrase weights for q in question(200), category(120), slug(100),
 *       answer(80), explanation/catechism/scripture(50), reference(40)
 *     FOR EACH term IN terms
 *       ADD field weights: question(50), category(40), slug(30), answer(25),
 *         explanation/catechism/scripture(15), reference(10)
 *       ADD 20 per question occurrence, 10 per answer occurrence, and
 *         5 per occurrence in explanation, catechism, or scripture
 *     IF score > 0 THEN APPEND (topic, score) TO results
 *   SORT results by score descending, then question alphabetically
 *   RETURN results
 * END FUNCTION
 *
 * With N topics, T query terms, and S searchable characters per topic, scoring
 * is O(N * T * S); sorting R matches costs O(R log R). Alphabetical
 * tie-breaking keeps equal scores deterministic.
 */
export function searchTopics(query: string, topics: Topic[]): TopicSearchResult[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return [];
  }

  const terms = q.split(/\s+/).filter(Boolean);

  return topics
    .map((topic) => {
      let score = 0;

      const fields = {
        question: topic.question.toLowerCase(),

        answer: topic.answer.toLowerCase(),

        category: topic.category.toLowerCase(),

        explanation: topic.explanation.toLowerCase(),

        catechism: topic.catechism.text.toLowerCase(),

        scripture: topic.scripture.text.toLowerCase(),

        reference: topic.scripture.reference.toLowerCase(),

        slug: topic.slug.toLowerCase(),
      };

      // ----------------------------------
      // Exact phrase matching
      // ----------------------------------

      if (fields.question.includes(q)) {
        score += 200;
      }

      if (fields.category.includes(q)) {
        score += 120;
      }

      if (fields.answer.includes(q)) {
        score += 80;
      }

      if (fields.explanation.includes(q)) {
        score += 50;
      }

      if (fields.catechism.includes(q)) {
        score += 50;
      }

      if (fields.scripture.includes(q)) {
        score += 50;
      }

      if (fields.reference.includes(q)) {
        score += 40;
      }

      if (fields.slug.includes(q)) {
        score += 100;
      }

      // ----------------------------------
      // Individual term scoring
      // ----------------------------------

      for (const term of terms) {
        if (fields.question.includes(term)) {
          score += 50;
        }

        if (fields.category.includes(term)) {
          score += 40;
        }

        if (fields.answer.includes(term)) {
          score += 25;
        }

        if (fields.explanation.includes(term)) {
          score += 15;
        }

        if (fields.catechism.includes(term)) {
          score += 15;
        }

        if (fields.scripture.includes(term)) {
          score += 15;
        }

        if (fields.reference.includes(term)) {
          score += 10;
        }

        if (fields.slug.includes(term)) {
          score += 30;
        }
      }

      // ----------------------------------
      // Frequency bonuses
      // ----------------------------------

      const countOccurrences = (text: string, term: string) => text.split(term).length - 1;

      for (const term of terms) {
        score += countOccurrences(fields.question, term) * 20;

        score += countOccurrences(fields.answer, term) * 10;

        score += countOccurrences(fields.explanation, term) * 5;

        score += countOccurrences(fields.catechism, term) * 5;

        score += countOccurrences(fields.scripture, term) * 5;
      }

      // ----------------------------------
      // Require at least one match
      // ----------------------------------

      if (score <= 0) {
        return null;
      }

      return {
        topic,
        score,
      };
    })
    .filter((result): result is TopicSearchResult => result !== null)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.topic.question.localeCompare(b.topic.question);
    });
}
