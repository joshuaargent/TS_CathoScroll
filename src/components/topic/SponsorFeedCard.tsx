'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';
import { recordSponsorCampaignEvent } from '@/lib/sponsor-analytics-client';
import { FeedInterstitialMotion } from './FeedInterstitialMotion';
import { TopicCardLayout } from './TopicCardLayout';

interface SponsorFeedCardProps {
  campaigns: SponsorFeedCampaign[];
  sessionId: string;
  userId: string;
  previewMode?: boolean;
  sponsorApiBaseUrl?: string;
  getAccessToken: () => Promise<string | null>;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
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
}: SponsorFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const navigationStarted = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const viewableCampaignIds = useRef(new Set<string>());

  const safeIndex = Math.min(activeIndex, Math.max(0, campaigns.length - 1));
  const campaign = campaigns[safeIndex];
  const campaignId = campaign?.campaign_id;

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

  const showPreviousCampaign = () => setActiveIndex(Math.max(0, safeIndex - 1));
  const showNextCampaign = () => setActiveIndex(Math.min(campaigns.length - 1, safeIndex + 1));

  return (
    <FeedInterstitialMotion
      ariaLabel="Sponsored content"
      onSwipeLeft={showNextCampaign}
      onSwipeRight={showPreviousCampaign}
      onNextTopic={navigateNextTopic}
      onPreviousTopic={navigatePreviousTopic}
    >
      <TopicCardLayout
        header={
          <>
            <p className="text-accent text-xs font-semibold tracking-wider uppercase">Sponsored</p>
            <span className="text-text-secondary rounded-full border px-3 py-1 text-sm tabular-nums">
              {safeIndex + 1} / {campaigns.length}
            </span>
          </>
        }
        footer={
          <div className="flex items-center justify-center pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={showPreviousCampaign}
                disabled={safeIndex === 0}
                aria-label="Previous sponsor"
                className="border-border rounded-full border p-2 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={showNextCampaign}
                disabled={safeIndex >= campaigns.length - 1}
                aria-label="Next sponsor"
                className="border-border rounded-full border p-2 disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
      >
        <article
          ref={cardRef}
          className="mx-auto w-full max-w-3xl text-center"
        >
          {campaign.image_url && (
            <div className="bg-bg-secondary relative mx-auto aspect-[16/7] w-full overflow-hidden rounded-2xl">
              <Image
                src={campaign.image_url}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 720px"
                unoptimized
                className="object-cover"
              />
            </div>
          )}
          <div className="px-1 py-4 md:px-4 md:py-6">
            <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
              {campaign.sponsor_logo_url && (
                <Image
                  src={campaign.sponsor_logo_url}
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="h-11 w-11 rounded-lg border border-border object-contain"
                />
              )}
              <div className="min-w-0 text-left">
                <p className="text-text-primary truncate font-semibold">{campaign.sponsor_name}</p>
                <p className="text-text-muted text-xs">Paid partnership</p>
              </div>
              <span className="border-border text-text-secondary ml-auto rounded-full border px-2.5 py-1 text-xs font-semibold">
                Sponsored
              </span>
            </div>

            <p className="text-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
              {campaign.campaign_name}
            </p>
            <h3 className="text-text-primary text-3xl leading-tight font-bold md:text-4xl">
              {campaign.headline}
            </h3>
            <p className="text-text-secondary mx-auto mt-3 max-w-2xl whitespace-pre-line text-lg leading-relaxed">
              {campaign.body}
            </p>

            <a
              href={campaign.destination_url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={(event) => {
                if (previewMode) {
                  event.preventDefault();
                  return;
                }
                if (viewableCampaignIds.current.has(campaign.campaign_id)) {
                  void recordEvent(campaign.campaign_id, 'click');
                }
              }}
              className="bg-accent text-white hover:bg-accent/90 mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors"
            >
              {campaign.cta_label}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </article>
      </TopicCardLayout>
    </FeedInterstitialMotion>
  );
}
