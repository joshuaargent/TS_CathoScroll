import type { Topic } from '@/types';

export interface TopicEngagement {
  completedTopicIds: string[];
  bookmarkedTopicIds: string[];
  likedTopicIds: string[];
  commentedTopicIds: string[];
}

interface RankedTopic {
  topic: Topic;
  score: number;
  originalIndex: number;
}

const engagementWeights = {
  completed: 5,
  bookmarked: 4,
  liked: 3,
  commented: 3,
} as const;

/**
 * Ranks unfinished topics using category affinities inferred from the user's
 * completed, saved, liked, and discussed topics. A greedy diversification pass
 * prevents a long run of recommendations from one category.
 *
 * AQA-style pseudocode:
 * FUNCTION recommendTopics(topics, engagement)
 *   FOR EACH interaction
 *     ADD weight 5 for completion, 4 for bookmark, 3 for like/comment
 *       to the interaction topic's category preference
 *   FOR EACH unfinished topic
 *     score ← category preference / square root(category topic count)
 *     ADD direct bookmark/like/comment weights for that same topic
 *   REPEATEDLY select the highest-scoring topic whose category has not
 *     appeared in the previous two results; break ties by original order
 *     if none exists, select the global highest so the algorithm progresses
 *   RETURN selected topics in that order
 * END FUNCTION
 *
 * Aggregation is O(n + e), where n is the catalogue size and e the signal
 * count. Greedy diversification is O(n²) in the worst case and uses O(n)
 * additional space. Original catalogue order makes ties deterministic.
 */
export function recommendTopics(topics: Topic[], engagement: TopicEngagement): Topic[] {
  const completed = new Set(engagement.completedTopicIds);
  const bookmarked = new Set(engagement.bookmarkedTopicIds);
  const liked = new Set(engagement.likedTopicIds);
  const commented = new Set(engagement.commentedTopicIds);
  const categoryTopicCounts = new Map<string, number>();
  const categoryPreferences = new Map<string, number>();
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  for (const topic of topics) {
    categoryTopicCounts.set(topic.category, (categoryTopicCounts.get(topic.category) ?? 0) + 1);
  }

  function addPreference(topicId: string, weight: number) {
    const topic = topicById.get(topicId);

    if (topic) {
      categoryPreferences.set(
        topic.category,
        (categoryPreferences.get(topic.category) ?? 0) + weight
      );
    }
  }

  new Set(engagement.completedTopicIds).forEach((id) =>
    addPreference(id, engagementWeights.completed)
  );
  new Set(engagement.bookmarkedTopicIds).forEach((id) =>
    addPreference(id, engagementWeights.bookmarked)
  );
  new Set(engagement.likedTopicIds).forEach((id) => addPreference(id, engagementWeights.liked));
  new Set(engagement.commentedTopicIds).forEach((id) =>
    addPreference(id, engagementWeights.commented)
  );

  const candidates: RankedTopic[] = topics
    .map((topic, originalIndex) => {
      const categoryCount = categoryTopicCounts.get(topic.category) ?? 1;
      const categoryAffinity = categoryPreferences.get(topic.category) ?? 0;
      const directInterest =
        (bookmarked.has(topic.id) ? engagementWeights.bookmarked : 0) +
        (liked.has(topic.id) ? engagementWeights.liked : 0) +
        (commented.has(topic.id) ? engagementWeights.commented : 0);

      return {
        topic,
        originalIndex,
        score: categoryAffinity / Math.sqrt(categoryCount) + directInterest,
      };
    })
    .filter(({ topic }) => !completed.has(topic.id));

  // If every topic is complete, keep the feed useful by showing the complete
  // catalogue rather than rendering an empty experience.
  const rankedCandidates =
    candidates.length > 0
      ? candidates
      : topics.map((topic, originalIndex) => ({
          topic,
          score: 0,
          originalIndex,
        }));

  const recommendations: Topic[] = [];
  const remaining = [...rankedCandidates];

  while (remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const lastCategory = recommendations.at(-1)?.category;
      const previousCategory = recommendations.at(-2)?.category;
      const wouldOverconcentrate =
        candidate.topic.category === lastCategory && candidate.topic.category === previousCategory;

      if (
        !wouldOverconcentrate &&
        (candidate.score > bestScore ||
          (candidate.score === bestScore &&
            (bestIndex < 0 || candidate.originalIndex < remaining[bestIndex].originalIndex)))
      ) {
        bestIndex = index;
        bestScore = candidate.score;
      }
    }

    // The guard relaxes the diversity rule only when all remaining candidates
    // would violate it, ensuring the algorithm always terminates.
    if (bestIndex < 0) {
      bestIndex = remaining.reduce(
        (best, candidate, index, list) =>
          candidate.score > list[best].score ||
          (candidate.score === list[best].score &&
            candidate.originalIndex < list[best].originalIndex)
            ? index
            : best,
        0
      );
    }

    recommendations.push(remaining.splice(bestIndex, 1)[0].topic);
  }

  return recommendations;
}
