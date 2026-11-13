'use client';

import { useEffect, useState } from 'react';

import { Bookmark, Share2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useSignInPrompt } from '@/components/providers/SignInPromptProvider';

import { Button } from '@/components/ui/Button';

interface TopicActionsProps {
  topicId: string;
  slug: string;
  title: string;
}

export function TopicActions({ topicId, slug, title }: TopicActionsProps) {
  const requestSignIn = useSignInPrompt();

  const [isBookmarked, setIsBookmarked] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  const [loadingBookmark, setLoadingBookmark] = useState(true);
  const [bookmarkError, setBookmarkError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingBookmark(true);

    async function loadBookmark() {
      const supabase = createClient();
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError && authError.name !== 'AuthSessionMissingError') throw authError;
        if (!user) {
          if (active) {
            setUserId(null);
            setIsBookmarked(false);
            setBookmarkError('');
          }
          return;
        }

        const { data, error } = await supabase
          .from('bookmarks')
          .select('id')
          .eq('user_id', user.id)
          .eq('topic_id', topicId)
          .maybeSingle();

        if (error) throw error;
        if (active) {
          setUserId(user.id);
          setIsBookmarked(Boolean(data));
          setBookmarkError('');
        }
      } catch (error) {
        console.error('Unable to load bookmark:', error);
        if (active) setBookmarkError('Unable to load your bookmark. Please try again.');
      } finally {
        if (active) setLoadingBookmark(false);
      }
    }

    void loadBookmark();
    return () => {
      active = false;
    };
  }, [topicId, loadVersion]);

  async function toggleBookmark() {
    if (!userId) {
      requestSignIn('save bookmarks');

      return;
    }

    const supabase = createClient();

    const currentlyBookmarked = isBookmarked;
    setBookmarkError('');

    if (currentlyBookmarked) {
      setIsBookmarked(false);

      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('topic_id', topicId);

      if (error) {
        setIsBookmarked(true);
        console.error('Unable to remove bookmark:', error);
        setBookmarkError('Unable to update your bookmark. Please try again.');
      }

      return;
    }

    setIsBookmarked(true);

    const { error } = await supabase.from('bookmarks').insert({
      user_id: userId,
      topic_id: topicId,
    });

    if (error) {
      setIsBookmarked(false);
      console.error('Unable to save bookmark:', error);
      setBookmarkError('Unable to update your bookmark. Please try again.');
    }
  }

  async function shareTopic() {
    try {
      const url = `${window.location.origin}/topic/${slug}`;

      if (navigator.share) {
        await navigator.share({
          title,
          url,
        });

        return;
      }

      await navigator.clipboard.writeText(url);
    } catch {}
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="button"
        variant={isBookmarked ? 'primary' : 'secondary'}
        onClick={toggleBookmark}
        disabled={loadingBookmark || Boolean(bookmarkError)}
        style={
          isBookmarked
            ? {
                color: '#ffffff',
              }
            : undefined
        }
      >
        <Bookmark className={`mr-2 h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
        {isBookmarked ? 'Bookmarked' : 'Bookmark Topic'}
      </Button>

      {bookmarkError && (
        <p role="alert" className="text-sm text-red-600">
          {bookmarkError}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setLoadingBookmark(true);
              setLoadVersion((version) => version + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}

      <Button type="button" variant="secondary" onClick={shareTopic}>
        <Share2 className="mr-2 h-4 w-4" />
        Share Topic
      </Button>
    </div>
  );
}
