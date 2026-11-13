import type { Topic } from '@/types';

export interface RecommendationCursor {
  userId: string;
  categories: {
    slug: string;
    weight: number;
    served: number;
    order: number | null;
    id: string | null;
  }[];
  last: string | null;
  streak: number;
  includeCompleted: boolean;
}

export interface RecommendationPage {
  topics: Topic[];
  nextCursor: RecommendationCursor | null;
}
