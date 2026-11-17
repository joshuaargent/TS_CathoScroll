import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { TopicNotesEditor } from '@/components/topic/TopicNotesEditor';
import type { CachedNote, NativeNoteCache } from './note-cache';
import { loadNativeNote, saveNativeNote } from './note-operations';
import {
  nativeNoteSaveKey,
  updateNativeNoteSaveState,
  type NativeNoteSaveState,
} from './note-save-state';
import { createClient } from './supabase';
import { notifyNativeStatus, clearNativeStatusNotice } from './offline-indicator';

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
  cache: NativeNoteCache | null;
}) {
  const [state, setState] = useState<NoteState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState('');
  const [savingState, setSavingState] = useState<NativeNoteSaveState>({});
  const saving = userId ? Boolean(savingState[nativeNoteSaveKey(userId, topicId)]) : false;
  const [messageState, setMessageState] = useState({ userId, topicId, value: '' });
  const message = messageState.userId === userId && messageState.topicId === topicId
    ? messageState.value
    : '';
  const dirty = useRef(false);
  const draft = useRef('');
  const identity = useRef({ userId, topicId });
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
    // A draft belongs to exactly one account/topic pair, never to the editor
    // instance across navigation or account switching.
    identity.current = { userId, topicId };
    dirty.current = false;
    draft.current = '';

  }, [userId, topicId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const accountId = userId;
    async function load() {
      setState({ userId: accountId, topicId, note: null, loading: true, warning: '', verified: false });
      const result = await loadNativeNote(
        cache,
        accountId,
        topicId,
        navigator.onLine
          ? async () => {
              const client = createClient();
              const { data: sessionData, error: sessionError } = await client.auth.getSession();
              if (sessionError) throw sessionError;
              if (sessionData.session?.user.id !== accountId) {
                throw new Error('The active account changed while loading a note.');
              }
              const response = await client
                .from('notes')
                .select('content')
                .eq('user_id', accountId)
                .eq('topic_id', topicId)
                .maybeSingle();
              if (response.error) throw response.error;
              return noteContent(response.data);
            }
          : null,
        (cachedNote, cachedWarning) => {
          if (!active) return;
          if (!dirty.current) {
            draft.current = cachedNote?.content ?? '';
            setContent(draft.current);
          }
          setState({
            userId: accountId,
            topicId,
            note: cachedNote,
            loading: false,
            warning: cachedWarning,
            verified: false,
          });
        },
        () => active
      );

      if (result.cacheLoadError) {
        console.error('Unable to load saved note:', result.cacheLoadError);
      }
      if (result.refreshError) {
        console.error('Unable to refresh note:', result.refreshError);
      }
      if (result.cacheSaveError) {
        console.error('Unable to save note for offline viewing:', result.cacheSaveError);
      }
      if (!active) return;

      if (!dirty.current) {
        draft.current = result.note?.content ?? '';
        setContent(draft.current);
      }
      setState({
        userId: accountId,
        topicId,
        note: result.note,
        loading: false,
        warning: result.warning,
        verified: result.verified,
      });
    }
    void load();
    return () => {
      active = false;
    };
  }, [cache, topicId, userId, attempt]);

  const current = state?.userId === userId && state.topicId === topicId ? state : null;

  useEffect(() => {
    if (!userId || !current?.warning) {
      if (userId) clearNativeStatusNotice('note-status:' + userId + ':' + topicId);
      return;
    }
    notifyNativeStatus(current.warning, {
      id: 'note-status:' + userId + ':' + topicId,
      action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
    });
    return () => clearNativeStatusNotice('note-status:' + userId + ':' + topicId);
  }, [userId, topicId, current?.warning]);

  useEffect(() => {
    const noticeId = userId ? 'note-offline:' + userId + ':' + topicId : '';
    if (!userId || (current?.verified && navigator.onLine)) {
      if (noticeId) clearNativeStatusNotice(noticeId);
      return;
    }
    if (!navigator.onLine) {
      notifyNativeStatus('Connect to view the latest note and make changes.', { id: noticeId });
    }
    return () => {
      if (noticeId) clearNativeStatusNotice(noticeId);
    };
  }, [userId, topicId, current?.verified]);

  async function save() {
    if (!userId || !current?.verified || !navigator.onLine || saving) return;
    const target = { userId, topicId };
    const savedContent = draft.current;
    const isCurrent = () =>
      identity.current.userId === target.userId && identity.current.topicId === target.topicId;
    setSavingState((previous) => updateNativeNoteSaveState(previous, target.userId, target.topicId, true));
    setMessageState({ ...target, value: '' });
    try {
      await saveNativeNote(createClient(), target.userId, target.topicId, savedContent);
      if (!isCurrent()) return;
      dirty.current = draft.current !== savedContent;
      setMessageState({ ...target, value: 'Saved successfully.' });
      if (cache) {
        try {
          await cache.save(target.userId, target.topicId, savedContent);
        } catch (error) {
          console.error('Unable to save note for offline viewing:', error);
          if (isCurrent()) {
            setMessageState({ ...target, value: 'Saved online, but this note could not be saved for offline viewing.' });
          }
        }
      } else if (isCurrent()) {
        setMessageState({ ...target, value: 'Saved online. Offline note storage is unavailable on this device.' });
      }
    } catch (error) {
      console.error('Unable to save note:', error);
      if (isCurrent()) {
        setMessageState({ ...target, value: 'Unable to save your note. Check your connection and try again.' });
      }
    } finally {
      // Remove only this account/topic operation; other in-flight saves remain visible.
      setSavingState((previous) => updateNativeNoteSaveState(previous, target.userId, target.topicId, false));
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
        message={message}
      />
    </>
  );
}
