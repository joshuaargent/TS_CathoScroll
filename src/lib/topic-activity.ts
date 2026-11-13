import type { createClient } from '@/lib/supabase/client';

export interface TopicActivity {
  topicId: string;
  userId: string | null;
  likes: number;
  comments: number;
  liked: boolean;
  bookmarked: boolean;
  completed: boolean;
}

export async function loadTopicActivity(
  supabase: ReturnType<typeof createClient>,
  topicId: string,
  userId: string | null
): Promise<TopicActivity> {
  // Count on the database rather than downloading a potentially truncated
  // table. User state is looked up only for the topic currently being viewed.
  const [likes, comments, liked, bookmarked, completed] = await Promise.all([
    supabase
      .from('topic_likes')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId),
    supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId)
      .eq('is_deleted', false),
    userId
      ? supabase
          .from('topic_likes')
          .select('topic_id')
          .eq('user_id', userId)
          .eq('topic_id', topicId)
          .maybeSingle()
      : null,
    userId
      ? supabase
          .from('bookmarks')
          .select('topic_id')
          .eq('user_id', userId)
          .eq('topic_id', topicId)
          .maybeSingle()
      : null,
    userId
      ? supabase
          .from('progress')
          .select('topic_id')
          .eq('user_id', userId)
          .eq('topic_id', topicId)
          .maybeSingle()
      : null,
  ]);

  const error =
    likes.error ?? comments.error ?? liked?.error ?? bookmarked?.error ?? completed?.error;
  if (error) {
    throw new Error(`Unable to load topic activity: ${error.message}`, { cause: error });
  }
  if (likes.count === null || comments.count === null) {
    throw new Error('Unable to load topic activity counts.');
  }

  return {
    topicId,
    userId,
    likes: likes.count,
    comments: comments.count,
    liked: Boolean(liked?.data),
    bookmarked: Boolean(bookmarked?.data),
    completed: Boolean(completed?.data),
  };
}
