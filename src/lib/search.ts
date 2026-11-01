import { topics } from '@/data/topics';

export function searchTopics(query: string) {
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
    .filter(
      (
        result
      ): result is {
        topic: (typeof topics)[number];
        score: number;
      } => result !== null
    )
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.topic.question.localeCompare(b.topic.question);
    });
}
