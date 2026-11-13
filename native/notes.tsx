import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { TopicNotesEditor } from '@/components/topic/TopicNotesEditor';
import type { CachedNote, NativeNoteCache } from './note-cache';
import { saveNativeNote } from './note-operations';
import { createClient } from './supabase';

type NoteState = {
  userId: string;
  topicId: string;
  note: CachedNote | null;
  loading: boolean;
  warning: string;
  verified: boolean;
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
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = useRef(false);
  const draft = useRef('');
  const requestSignIn = useSignInPrompt();

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
      setState({ userId: accountId, topicId, note, loading: true, warning, verified: false });
      try {
        note = await cache.load(accountId, topicId);
      } catch (error) {
        console.error('Unable to load saved note:', error);
        cacheReadable = false;
        warning = 'Your saved note could not be opened on this device.';
      }
      if (!active) return;
      if (!dirty.current) {
        draft.current = note?.content ?? '';
        setContent(draft.current);
      }
      setState({ userId: accountId, topicId, note, loading: false, warning, verified: false });
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
        if (!dirty.current) {
          draft.current = content ?? '';
          setContent(draft.current);
        }
        if (cacheReadable) {
          try {
            await cache.save(accountId, topicId, content);
            warning = '';
          } catch (error) {
            console.error('Unable to save note for offline viewing:', error);
            warning = 'This note could not be saved for offline viewing.';
          }
        }
        if (active) {
          setState({ userId: accountId, topicId, note, loading: false, warning, verified: true });
        }
      } catch (error) {
        console.error('Unable to refresh note:', error);
        if (active) {
          setState({
            userId: accountId,
            topicId,
            note,
            loading: false,
            warning: warning || 'Your note could not be refreshed. Please try again.',
            verified: false,
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
  async function save() {
    if (!userId || !current?.verified || !navigator.onLine || saving) return;
    const savedContent = draft.current;
    setSaving(true);
    setMessage('');
    try {
      await saveNativeNote(createClient(), userId, topicId, savedContent);
      dirty.current = draft.current !== savedContent;
      setMessage('Saved successfully.');
      try {
        await cache.save(userId, topicId, savedContent);
      } catch (error) {
        console.error('Unable to save note for offline viewing:', error);
        setMessage('Saved online, but this note could not be saved for offline viewing.');
      }
    } catch (error) {
      console.error('Unable to save note:', error);
      setMessage('Unable to save your note. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!userId) {
    return (
      <section className="border-border mb-16 rounded-2xl border p-8">
        <h2 className="text-3xl font-bold">My Notes</h2>
        <p className="text-text-secondary mt-4">Sign in to create personal notes for this topic.</p>
        <button
          type="button"
          onClick={() => requestSignIn('write personal notes')}
          className="text-accent mt-6 inline-flex font-medium"
        >
          Sign In →
        </button>
      </section>
    );
  }
  if (!current || current.loading) {
    return (
      <section className="border-border mb-16 rounded-2xl border p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </section>
    );
  }
  return (
    <>
      <TopicNotesEditor
        content={content}
        onChange={(value) => {
          dirty.current = true;
          draft.current = value;
          setContent(value);
        }}
        onSave={() => void save()}
        saving={saving}
        disabled={!current.verified || !navigator.onLine}
        notice={
          !current.verified || !navigator.onLine
            ? 'Connect to view the latest note and make changes.'
            : undefined
        }
        message={message}
      />
      {current.warning && (
        <p role="alert" className="mb-6">
          {current.warning}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      )}
    </>
  );
}
