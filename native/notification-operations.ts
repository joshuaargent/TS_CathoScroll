import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Notification,
  NotificationTransport,
} from '@/components/notifications/NotificationList';

type NotificationRow = Omit<Notification, 'topic_slug'>;

export function notificationTransport(
  client: SupabaseClient,
  userId: string
): NotificationTransport & { unreadCount(): Promise<number> } {
  async function checkAccount() {
    if (!navigator.onLine) throw new Error('Connect to view and update notifications.');
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== userId) throw new Error('Your account changed. Please sign in again.');
  }

  async function unreadCount() {
    await checkAccount();
    const { count, error } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    if (count === null) throw new Error('Unable to load the unread notification count.');
    return count;
  }

  return {
    unreadCount,
    async load() {
      const count = await unreadCount();
      const { data, error } = await client
        .from('notifications')
        .select('id,type,title,body,topic_id,comment_id,read_at,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows: NotificationRow[] = data;
      const ids = [...new Set(rows.map((row) => row.topic_id).filter((id): id is string => !!id))];
      const { data: topics, error: topicsError } = ids.length
        ? await client.from('topics').select('id,slug').in('id', ids)
        : { data: [], error: null };
      if (topicsError) throw topicsError;
      const slugs = new Map((topics ?? []).map((topic) => [topic.id, topic.slug]));
      return {
        unreadCount: count,
        notifications: rows.map((row) => ({
          ...row,
          topic_slug: row.topic_id ? (slugs.get(row.topic_id) ?? null) : null,
        })),
      };
    },
    async markAsRead(id) {
      await checkAccount();
      let query = client
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('read_at', null);
      if (id !== 'all') query = query.eq('id', id);
      const { data, error } = await query.select('id');
      if (error) throw error;
      if (id !== 'all' && !data?.length) throw new Error('Notification not found.');
    },
  };
}
