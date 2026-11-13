'use client';

import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { TopicNotesEditor } from './TopicNotesEditor';

interface TopicNotesProps {
  topicId: string;
}

export function TopicNotes({ topicId }: TopicNotesProps) {
  const requestSignIn = useSignInPrompt();
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [signedIn, setSignedIn] = useState(false);

  const [content, setContent] = useState('');

  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadNote() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setSignedIn(true);

      const { data } = await supabase
        .from('notes')
        .select('content')
        .eq('user_id', user.id)
        .eq('topic_id', topicId)
        .maybeSingle();

      if (data) {
        setContent(data.content);
      }

      setLoading(false);
    }

    loadNote();
  }, [topicId]);

  async function saveNote() {
    setSaving(true);

    setMessage('');

    try {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const { error } = await supabase.from('notes').upsert(
        {
          user_id: user.id,
          topic_id: topicId,
          content,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,topic_id',
        }
      );

      if (!error) {
        setMessage('Saved successfully.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="border-border mb-16 rounded-2xl border p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </section>
    );
  }

  if (!signedIn) {
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

  return (
    <TopicNotesEditor
      content={content}
      onChange={setContent}
      onSave={() => void saveNote()}
      saving={saving}
      message={message}
    />
  );
}
