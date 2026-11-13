import type { SupabaseClient } from '@supabase/supabase-js';

export async function saveNativeNote(
  client: SupabaseClient,
  userId: string,
  topicId: string,
  content: string
): Promise<void> {
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error('Unable to verify your account.', { cause: error });
  if (data.user?.id !== userId) throw new Error('The active account changed.');

  const { error: saveError } = await client
    .from('notes')
    .upsert(
      { user_id: userId, topic_id: topicId, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,topic_id' }
    );
  if (saveError) throw new Error('Unable to save your note.', { cause: saveError });
}
