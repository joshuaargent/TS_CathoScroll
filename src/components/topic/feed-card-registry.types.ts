import type { TopFeedComment } from '@/lib/feed-comments';
import type { FeedEntry, FeedEntryLike, FeedEntryDirection } from '@/lib/feed-entry-map';

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
  activateInterstitialTopic: (topicId: string | null) => void;
  markCommentSeen: (commentId: number) => void;
  cacheCommentGroup: (topicId: string, comments: TopFeedComment[]) => void;
  getTopCommentIndex: (topicId: string) => number;
  loadSponsorEntry: (
    entry: Extract<FeedEntry, { type: 'sponsor' }>,
    direction: FeedEntryDirection,
    entries: readonly FeedEntryLike[]
  ) => Promise<void>;
  cancelSponsorRequest: (
    entry: Extract<FeedEntry, { type: 'sponsor' }>,
    direction: FeedEntryDirection
  ) => void;
};
