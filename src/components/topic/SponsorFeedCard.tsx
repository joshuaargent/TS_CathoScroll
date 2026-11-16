'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

import type { SponsorFeedCampaign } from '@/lib/sponsor-campaigns';

interface SponsorFeedCardProps {
  campaigns: SponsorFeedCampaign[];
  sessionId: string;
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
  getAccessToken,
  onNextTopic,
  onPreviousTopic,
}: SponsorFeedCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const viewableCampaignIds = useRef(new Set<string>());

  const safeIndex = Math.min(activeIndex, Math.max(0, campaigns.length - 1));
  const campaign = campaigns[safeIndex];
  const campaignId = campaign?.campaign_id;

  const recordEvent = useCallback(
    async (targetCampaignId: string, eventType: 'viewable_impression' | 'click') => {
      try {
        const accessToken = await getAccessToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const response = await fetch('/api/content/sponsor-campaign-events', {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers,
          body: JSON.stringify({
            campaignId: targetCampaignId,
            eventId: createEventId(),
            sessionId,
            eventType,
          }),
        });
        if (!response.ok) return false;
        const result: { recorded?: boolean } = await response.json();
        return result.recorded === true;
      } catch {
        return false;
      }
    },
    [getAccessToken, sessionId]
  );

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !campaignId || viewableCampaignIds.current.has(campaignId)) return;

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
  }, [campaignId, recordEvent]);

  if (!campaign) return null;

  const showPreviousCampaign = () => setActiveIndex(Math.max(0, safeIndex - 1));
  const showNextCampaign = () => setActiveIndex(Math.min(campaigns.length - 1, safeIndex + 1));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a,button')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 40) return;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) showNextCampaign();
      else showPreviousCampaign();
      return;
    }
    if (deltaY < 0) onNextTopic();
    else onPreviousTopic();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPreviousCampaign();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showNextCampaign();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      onNextTopic();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onPreviousTopic();
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 pb-6"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onKeyDown={handleKeyDown}
      style={{ touchAction: 'pan-y' }}
      tabIndex={0}
      role="region"
      aria-roledescription="sponsored feed card"
      aria-label="Sponsored content"
    >
      <header className="flex items-center justify-between gap-4 pt-4 pb-5">
        <div>
          <p className="text-accent text-xs font-semibold tracking-[0.16em] uppercase">
            Sponsored
          </p>
          <h2 className="text-text-primary mt-1 text-xl font-bold">Partner message</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Clearly labelled support for CathoScroll
          </p>
        </div>
        <span className="text-text-secondary rounded-full border px-3 py-1 text-sm tabular-nums">
          {safeIndex + 1} / {campaigns.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <article
          ref={cardRef}
          className="bg-bg-card border-border w-full overflow-hidden rounded-3xl border"
        >
          {campaign.image_url && (
            <div className="bg-bg-secondary relative aspect-[16/7] w-full">
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
          <div className="p-6">
            <div className="mb-5 flex flex-wrap items-center gap-3">
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
              <div className="min-w-0">
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
            <h3 className="text-text-primary text-2xl leading-tight font-bold">
              {campaign.headline}
            </h3>
            <p className="text-text-secondary mt-3 whitespace-pre-line leading-relaxed">
              {campaign.body}
            </p>

            <a
              href={campaign.destination_url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => {
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
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <button
          type="button"
          onClick={onPreviousTopic}
          className="border-border text-text-secondary hover:bg-bg-secondary inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous topic
        </button>
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
        <button
          type="button"
          onClick={onNextTopic}
          className="border-border text-text-secondary hover:bg-bg-secondary inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors"
        >
          Next topic
          <ChevronRight className="h-4 w-4" />
        </button>
      </footer>
      <p className="text-text-muted pt-3 text-center text-xs">
        Swipe horizontally to browse partners, or vertically to move through the feed
      </p>
    </div>
  );
}
