'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Bookmark, Share2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';

import { Button } from '@/components/ui/Button';

interface TopicActionsProps {
  topicId: string;
  slug: string;
  title: string;
}

export function TopicActions({ topicId, slug, title }: TopicActionsProps) {
  const router = useRouter();

  const [isBookmarked, setIsBookmarked] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function loadBookmark() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      setUserId(user.id);

      const { data } = await supabase
        .from('bookmarks')
        .select('id')
        .eq('user_id', user.id)
        .eq('topic_id', topicId)
        .maybeSingle();

      setIsBookmarked(!!data);
    }

    loadBookmark();
  }, [topicId]);

  async function toggleBookmark() {
    if (!userId) {
      router.push('/signin');

      return;
    }

    const supabase = createClient();

    const currentlyBookmarked = isBookmarked;

    if (currentlyBookmarked) {
      setIsBookmarked(false);

      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', userId)
        .eq('topic_id', topicId);

      if (error) {
        setIsBookmarked(true);
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

      <Button type="button" variant="secondary" onClick={shareTopic}>
        <Share2 className="mr-2 h-4 w-4" />
        Share Topic
      </Button>
    </div>
  );
}
