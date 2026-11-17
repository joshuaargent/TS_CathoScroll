'use client';

import { useState } from 'react';

import { SponsorFeedCard } from '@/components/topic/SponsorFeedCard';
import { TopCommentFeedCard } from '@/components/topic/TopCommentFeedCard';
import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';
import type { TopFeedComment } from '@/lib/feed-comments';

const previewComment: TopFeedComment = {
  comment_id: 900001,
  topic_slug: 'sample-prayer-topic',
  topic_question: 'How can prayer shape everyday life?',
  category_name: 'Prayer',
  author_display_name: 'CathoScroll Preview',
  author_username: 'preview',
  content:
    'Prayer gives us a quiet moment to turn our attention towards God. Even a short, honest prayer can help bring faith into ordinary decisions and daily responsibilities.',
  content_truncated: false,
  created_at: '2026-01-01T12:00:00.000Z',
  is_pinned: true,
  like_count: 12,
  reply_count: 3,
};

const previewSponsor: SponsorFeedCampaign = {
  campaign_id: '00000000-0000-4000-8000-000000000001',
  sponsor_name: 'Preview Partner',
  sponsor_logo_url: null,
  campaign_name: 'Sample sponsor campaign',
  headline: 'A sample sponsor headline',
  body:
    'This is fixture content for reviewing the sponsored card layout. It is not a live campaign and does not represent an actual sponsor.',
  image_url: null,
  destination_url: 'https://example.com',
  cta_label: 'Preview call to action',
  disclosure: 'Sponsored',
};

export function FeedCardPreview({ userId }: { userId: string }) {
  const [activeCard, setActiveCard] = useState<'comments' | 'sponsor'>('comments');
  const noop = () => undefined;

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Feed card previews</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Isolated fixture content. Preview interactions do not create comments,
            campaigns, impressions, clicks, or analytics events.
          </p>
        </div>
        <div className="flex gap-2" aria-label="Choose preview card">
          <button
            type="button"
            aria-pressed={activeCard === 'comments'}
            onClick={() => setActiveCard('comments')}
            className={activeCard === 'comments'
              ? 'bg-accent rounded-lg px-4 py-2 text-sm font-semibold text-white'
              : 'border-border rounded-lg border px-4 py-2 text-sm'}
          >
            Top comments
          </button>
          <button
            type="button"
            aria-pressed={activeCard === 'sponsor'}
            onClick={() => setActiveCard('sponsor')}
            className={activeCard === 'sponsor'
              ? 'bg-accent rounded-lg px-4 py-2 text-sm font-semibold text-white'
              : 'border-border rounded-lg border px-4 py-2 text-sm'}
          >
            Sponsor
          </button>
        </div>
      </div>
      <div className="bg-bg-primary border-border h-[min(760px,75vh)] min-h-[600px] overflow-hidden rounded-2xl border">
        {activeCard === 'comments' ? (
          <TopCommentFeedCard
            comments={[previewComment]}
            userId={userId}
            previewMode
            onNextTopic={noop}
            onPreviousTopic={noop}
            onOpenComment={noop}
            onCommentViewed={noop}
          />
        ) : (
          <SponsorFeedCard
            campaigns={[previewSponsor]}
            sessionId="00000000-0000-4000-8000-000000000002"
            userId={userId}
            previewMode
            getAccessToken={async () => null}
            onNextTopic={noop}
            onPreviousTopic={noop}
          />
        )}
      </div>
      <p className="text-text-muted mt-3 text-xs">
        Preview only. Fixture records are rendered in the browser and are never written to Supabase.
      </p>
    </section>
  );
}
