'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DoorOpen, Share2 } from 'lucide-react';

import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';
import { recordSponsorCampaignEvent } from '@/lib/sponsor-analytics-client';
import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { TopicCardLayout } from './TopicCardLayout';
import { TopicProgress } from './TopicProgress';

interface SponsorFeedCardProps {
  campaigns: SponsorFeedCampaign[];
  sessionId: string;
  userId: string;
  previewMode?: boolean;
  sponsorApiBaseUrl?: string;
  getAccessToken: () => Promise<string | null>;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
  nextEntryPreview?: ReactNode;
  previousEntryPreview?: ReactNode;
}

function createEventId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function SponsorFeedCard({
  campaigns,
  sessionId,
  userId,
  previewMode = false,
  sponsorApiBaseUrl,
  getAccessToken,
  onNextTopic,
  onPreviousTopic,
  nextEntryPreview,
  previousEntryPreview,
}: SponsorFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const navigationStarted = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const viewableCampaignIds = useRef(new Set<string>());

  const safeIndex = Math.min(activeIndex, Math.max(0, campaigns.length - 1));
  const campaign = campaigns[safeIndex];
  const campaignId = campaign?.campaign_id;

  useEffect(() => {
    if (!previewMode) navigationStarted.current = false;
  }, [previewMode, campaigns]);

  const recordEvent = useCallback(
    async (targetCampaignId: string, eventType: 'viewable_impression' | 'click') => {
      if (previewMode) return false;
      return recordSponsorCampaignEvent(
        userId,
        {
          campaignId: targetCampaignId,
          eventId: createEventId(),
          sessionId,
          eventType,
        },
        getAccessToken,
        sponsorApiBaseUrl
      );
    },
    [getAccessToken, previewMode, sessionId, sponsorApiBaseUrl, userId]
  );

  useEffect(() => {
    const node = cardRef.current;
    if (previewMode || !node || !campaignId || viewableCampaignIds.current.has(campaignId)) return;

    let timer: number | null = null;
    let visible = false;
    let cancelled = false;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleViewable = () => {
      if (timer !== null || !visible || document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => {
        timer = null;
        if (!visible || document.visibilityState !== 'visible' || cancelled) return;
        void recordEvent(campaignId, 'viewable_impression').then((recorded) => {
          if (recorded && !cancelled) viewableCampaignIds.current.add(campaignId);
        });
      }, 1000);
    };

    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          const entry = entries[0];
          visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
          if (visible) scheduleViewable();
          else clearTimer();
        }, { threshold: [0, 0.5, 1] })
      : null;

    if (observer) observer.observe(node);
    else {
      visible = true;
      scheduleViewable();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleViewable();
      else clearTimer();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [campaignId, previewMode, recordEvent]);

  if (!campaign) return null;

  const navigateNextTopic = () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    onNextTopic();
  };

  const navigatePreviousTopic = () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    onPreviousTopic();
  };

  const showPreviousCampaign = () => setActiveIndex((index) => Math.max(0, index - 1));
  const showNextCampaign = () => setActiveIndex((index) => Math.min(campaigns.length - 1, index + 1));

  const recordCampaignClick = () => {
    if (!previewMode && viewableCampaignIds.current.has(campaign.campaign_id)) {
      void recordEvent(campaign.campaign_id, 'click');
    }
  };

  const openDestination = () => {
    if (previewMode) return;
    recordCampaignClick();
    window.open(campaign.destination_url, '_blank', 'noopener,noreferrer');
  };

  const shareCampaign = async () => {
    if (previewMode) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: campaign.headline,
          url: campaign.destination_url,
        });
        return;
      }

      await navigator.clipboard.writeText(campaign.destination_url);
    } catch {}
  };

  return (
    <FeedInterstitialMotion
      ariaLabel="Sponsored content"
      active={!previewMode}
      onSwipeLeft={showNextCampaign}
      onSwipeRight={showPreviousCampaign}
      canSwipeLeft={() => safeIndex < campaigns.length - 1}
      canSwipeRight={() => safeIndex > 0}
      onNextTopic={navigateNextTopic}
      onPreviousTopic={navigatePreviousTopic}
      nextPreview={nextEntryPreview}
      previousPreview={previousEntryPreview}
    >
      <TopicCardLayout
        progress={<TopicProgress current={safeIndex} total={campaigns.length} />}
        header={
          <>
            <div className="min-w-0">
              <p className="text-text-muted truncate text-sm font-medium">
                {campaign.sponsor_name}
              </p>
              <p className="text-text-muted text-xs tracking-wider uppercase">
                {campaign.disclosure || 'Sponsored'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={() => void shareCampaign()}
                disabled={previewMode}
                aria-label={`Share ${campaign.sponsor_name}`}
                title="Share sponsor"
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-5 w-5" />
              </button>
              <a
                href={campaign.destination_url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => {
                  if (previewMode) {
                    event.preventDefault();
                    return;
                  }
                  recordCampaignClick();
                }}
                aria-label={`Visit ${campaign.sponsor_name} website`}
                title={campaign.cta_label || 'Visit website'}
                className="text-text-muted hover:bg-bg-secondary hover:text-text-primary flex h-11 w-11 items-center justify-center rounded-full transition-colors"
              >
                <DoorOpen className="h-5 w-5" />
              </a>
            </div>
          </>
        }
      >
        <article
          ref={cardRef}
          className="mx-auto w-full max-w-3xl cursor-pointer px-1 py-3 text-center md:px-4 md:py-5"
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('button, a')) return;
            openDestination();
          }}
          aria-label={`${campaign.sponsor_name} sponsored message. Double-click to visit their website.`}
          title="Double-click to visit sponsor website"
        >
          <h3 className="text-text-primary text-3xl leading-tight font-bold md:text-4xl">
            {campaign.headline}
          </h3>
          <p className="text-text-secondary mx-auto mt-4 max-w-2xl whitespace-pre-line text-base leading-relaxed md:text-lg">
            {campaign.body}
          </p>
          <div className="mt-6 flex items-center justify-center">
            <a
              href={campaign.destination_url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => {
                if (previewMode) {
                  event.preventDefault();
                  return;
                }
                recordCampaignClick();
              }}
              className="text-text-muted hover:text-text-primary text-sm font-medium transition-colors"
            >
              Visit {campaign.sponsor_name}
            </a>
          </div>
        </article>
      </TopicCardLayout>
    </FeedInterstitialMotion>
  );
}
