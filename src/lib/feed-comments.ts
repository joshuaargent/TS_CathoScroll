export const TOP_COMMENT_CADENCE = 5;

export interface TopFeedComment {
  comment_id: number;
  topic_slug: string;
  topic_question: string;
  category_name: string;
  author_display_name: string;
  author_username: string | null;
  content: string;
  content_truncated: boolean;
  created_at: string;
  is_pinned: boolean;
  like_count: number;
  reply_count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTopFeedComment(value: unknown): value is TopFeedComment {
  if (!isRecord(value)) return false;

  return (
    Number.isSafeInteger(value.comment_id) &&
    Number(value.comment_id) > 0 &&
    typeof value.topic_slug === 'string' &&
    value.topic_slug.length > 0 &&
    value.topic_slug.length <= 150 &&
    typeof value.topic_question === 'string' &&
    value.topic_question.length > 0 &&
    value.topic_question.length <= 500 &&
    typeof value.category_name === 'string' &&
    value.category_name.length > 0 &&
    value.category_name.length <= 120 &&
    typeof value.author_display_name === 'string' &&
    value.author_display_name.length > 0 &&
    value.author_display_name.length <= 120 &&
    (value.author_username === null ||
      (typeof value.author_username === 'string' &&
        value.author_username.length > 0 &&
        value.author_username.length <= 40)) &&
    typeof value.content === 'string' &&
    value.content.length > 0 &&
    value.content.length <= 600 &&
    typeof value.content_truncated === 'boolean' &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.is_pinned === 'boolean' &&
    Number.isSafeInteger(value.like_count) &&
    Number(value.like_count) >= 0 &&
    Number.isSafeInteger(value.reply_count) &&
    Number(value.reply_count) >= 0
  );
}

export function parseTopFeedComments(value: unknown): TopFeedComment[] {
  if (!isRecord(value) || !Array.isArray(value.comments)) return [];
  return value.comments.filter(isTopFeedComment).slice(0, 5);
}

export function shouldInsertTopCommentCard(
  topicsSinceLastCard: number,
  hasEligibleComments: boolean
): boolean {
  return (
    hasEligibleComments &&
    Number.isSafeInteger(topicsSinceLastCard) &&
    topicsSinceLastCard >= 0 &&
    topicsSinceLastCard + 1 >= TOP_COMMENT_CADENCE
  );
}

export function getNextTopCommentCadence(topicsSinceLastCard: number): number {
  if (!Number.isSafeInteger(topicsSinceLastCard) || topicsSinceLastCard < 0) return 0;
  return (topicsSinceLastCard + 1) % TOP_COMMENT_CADENCE;
}

export function toPublicTopFeedComment(comment: TopFeedComment): TopFeedComment {
  return {
    comment_id: comment.comment_id,
    topic_slug: comment.topic_slug,
    topic_question: comment.topic_question,
    category_name: comment.category_name,
    author_display_name: comment.author_display_name,
    author_username: comment.author_username,
    content: comment.content,
    content_truncated: comment.content_truncated,
    created_at: comment.created_at,
    is_pinned: comment.is_pinned,
    like_count: comment.like_count,
    reply_count: comment.reply_count,
  };
}

export function getUnseenTopFeedComments(
  comments: TopFeedComment[],
  seenCommentIds: ReadonlySet<number>
): TopFeedComment[] {
  return comments.filter((comment) => !seenCommentIds.has(comment.comment_id));
}
