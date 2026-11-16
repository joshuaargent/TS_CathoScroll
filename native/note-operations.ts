import type { SupabaseClient } from '@supabase/supabase-js';
import type { CachedNote, NativeNoteCache } from './note-cache';

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

export interface NativeNoteLoadResult {
  note: CachedNote | null;
  warning: string;
  verified: boolean;
  cacheLoadError?: unknown;
  refreshError?: unknown;
  cacheSaveError?: unknown;
}

export async function loadNativeNote(
  cache: Pick<NativeNoteCache, 'load' | 'save'>,
  userId: string,
  topicId: string,
  fetchOnline: (() => Promise<string | null>) | null,
  onCached?: (note: CachedNote | null, warning: string) => void,
  isCurrent: () => boolean = () => true
): Promise<NativeNoteLoadResult> {
  let note: CachedNote | null = null;
  let warning = '';
  let cacheLoadError: unknown;

  try {
    note = await cache.load(userId, topicId);
  } catch (error) {
    cacheLoadError = error;
    warning = 'Your saved note could not be opened on this device.';
  }

  onCached?.(note, warning);

  if (!fetchOnline) {
    return { note, warning, verified: false, cacheLoadError };
  }

  let content: string | null;
  try {
    content = await fetchOnline();
  } catch (refreshError) {
    return {
      note,
      warning: warning || 'Your note could not be refreshed. Please try again.',
      verified: false,
      cacheLoadError,
      refreshError,
    };
  }

  if (!isCurrent()) {
    return { note, warning, verified: false, cacheLoadError };
  }

  note = { content, savedAt: new Date().toISOString() };
  try {
    // A successful server response is authoritative. This also repairs a
    // corrupt ciphertext row; save() still refuses to replace a missing key
    // when encrypted note rows already exist.
    await cache.save(userId, topicId, content);
    warning = '';
  } catch (cacheSaveError) {
    warning = 'This note could not be saved for offline viewing.';
    return { note, warning, verified: true, cacheLoadError, cacheSaveError };
  }

  return { note, warning, verified: true, cacheLoadError };
}
