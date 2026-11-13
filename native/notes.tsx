import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CachedNote, NativeNoteCache } from './note-cache';
import { createClient } from './supabase';

type NoteState = {
  userId: string;
  topicId: string;
  note: CachedNote | null;
  loading: boolean;
  warning: string;
};

function noteContent(row: unknown): string | null {
  if (row === null) return null;
  if (typeof row === 'object' && 'content' in row && typeof row.content === 'string') {
    return row.content;
  }
  throw new Error('Invalid note returned by the server.');
}

export function NativeNotes({
  userId,
  topicId,
  cache,
}: {
  userId: string | null;
  topicId: string;
  cache: NativeNoteCache;
}) {
  const [state, setState] = useState<NoteState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1);
    window.addEventListener('online', retry);
    window.addEventListener('offline', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('offline', retry);
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const accountId = userId;
    async function load() {
      let note: CachedNote | null = null;
      let warning = '';
      let cacheReadable = true;
      setState({ userId: accountId, topicId, note, loading: true, warning });
      try {
        note = await cache.load(accountId, topicId);
      } catch (error) {
        console.error('Unable to load saved note:', error);
        cacheReadable = false;
        warning = 'Your saved note could not be opened on this device.';
      }
      if (!active) return;
      setState({ userId: accountId, topicId, note, loading: false, warning });
      if (!navigator.onLine) return;
      try {
        const client = createClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionData.session?.user.id !== accountId) {
          throw new Error('The active account changed while loading a note.');
        }
        const result = await client
          .from('notes')
          .select('content')
          .eq('user_id', accountId)
          .eq('topic_id', topicId)
          .maybeSingle();
        if (result.error) throw result.error;
        const row: unknown = result.data;
        const content = noteContent(row);
        if (!active) return;
        note = { content, savedAt: new Date().toISOString() };
        if (cacheReadable) {
          try {
            await cache.save(accountId, topicId, content);
            warning = '';
          } catch (error) {
            console.error('Unable to save note for offline viewing:', error);
            warning = 'This note could not be saved for offline viewing.';
          }
        }
        if (active) setState({ userId: accountId, topicId, note, loading: false, warning });
      } catch (error) {
        console.error('Unable to refresh note:', error);
        if (active) {
          setState({
            userId: accountId,
            topicId,
            note,
            loading: false,
            warning: warning || 'Your note could not be refreshed. Please try again.',
          });
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [cache, topicId, userId, attempt]);

  const current = state?.userId === userId && state.topicId === topicId ? state : null;
  return (
    <section className="border-border bg-bg-secondary/30 mb-16 rounded-2xl border p-8">
      <h2 className="text-3xl font-bold">My Notes</h2>
      {!userId ? (
        <p className="text-text-secondary mt-4">
          <Link href="/signin" className="text-accent underline">
            Sign in
          </Link>{' '}
          to view your notes.
        </p>
      ) : !current || current.loading ? (
        <p role="status" className="text-text-secondary mt-4">
          Loading your note…
        </p>
      ) : (
        <>
          <p className="text-text-secondary mt-3">
            Notes are read-only in the app. Edit them on the website.
          </p>
          {current.warning && (
            <p role="alert" className="mt-4">
              {current.warning}{' '}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry
              </button>
            </p>
          )}
          {current.note ? (
            <p className="border-border bg-bg-card mt-6 rounded-xl border p-4 whitespace-pre-wrap">
              {current.note.content || 'No note for this topic.'}
            </p>
          ) : !current.warning ? (
            <p className="text-text-secondary mt-4">
              Connect to the internet to load your note for this topic.
            </p>
          ) : null}
          {!navigator.onLine && current.note && (
            <p role="status" className="text-text-secondary mt-4 text-sm">
              You&apos;re offline. Your note may not include changes made on another device.
            </p>
          )}
        </>
      )}
    </section>
  );
}
