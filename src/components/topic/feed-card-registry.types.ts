import type { TopFeedComment } from '@/lib/feed-comments';
import type { FeedEntry } from '@/lib/feed-entry-map';

export type FeedCardRendererContext = {
  userId: string | null;
  sponsorApiBaseUrl?: string;
  getSponsorAccessToken?: () => Promise<string | null>;
  activeTopCommentIndex: number;
  onTopCommentIndexChange: (topicId: string, index: number) => void;
  onCommentViewed: (commentId: number) => void;
  onOpenComment: (comment: TopFeedComment) => void;
  onNext: (entry: FeedEntry) => void | Promise<void>;
  onPrevious: (entry: FeedEntry) => void | Promise<void>;
};

export type FeedCardRegistryFactory = (
  context: FeedCardRendererContext
) => import('@/lib/feed-entry-registry').FeedEntryRegistration<FeedCardRendererContext>[];
