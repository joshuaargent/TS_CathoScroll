import type { TopFeedComment } from '@/lib/feed-comments';
import type { FeedEntry } from '@/lib/feed-entry-map';
import type { FeedEntryLike, FeedEntryDirection } from '@/lib/feed-entry-registry';

export type FeedCardRendererContext = {
  userId: string | null;
  sponsorApiBaseUrl?: string;
  getSponsorAccessToken?: () => Promise<string | null>;
  activeTopCommentIndex: number;
  onTopCommentIndexChange: (topicId: string, index: number) => void;
  onCommentViewed: (commentId: number) => void;
  onOpenComment: (comment: TopFeedComment) => void;
  navigateNext: (entry: FeedEntry) => void | Promise<void>;
  navigatePrevious: (entry: FeedEntry) => void | Promise<void>;
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
