'use client';

import { useEffect } from 'react';
import { installSponsorAnalyticsListeners } from '@/lib/sponsor-analytics-client';
import { createClient } from '@/lib/supabase/client';

type SponsorAnalyticsSyncProps = {
  apiBaseUrl?: string;
  userId?: string | null;
  getAccessToken?: () => Promise<string | null>;
};

export function SponsorAnalyticsSync({
  apiBaseUrl,
  userId,
  getAccessToken,
}: SponsorAnalyticsSyncProps) {
  useEffect(() => {
    if (getAccessToken) {
      if (!userId) return;
      return installSponsorAnalyticsListeners(userId, getAccessToken, apiBaseUrl);
    }

    const supabase = createClient();
    let active = true;
    let currentUserId: string | null = null;
    let removeListeners: (() => void) | null = null;

    const applySession = (session: { user: { id: string } } | null) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === currentUserId) return;

      removeListeners?.();
      removeListeners = null;
      currentUserId = nextUserId;

      if (!nextUserId) return;
      const ownerId = nextUserId;
      removeListeners = installSponsorAnalyticsListeners(
        ownerId,
        async () => {
          const { data, error } = await supabase.auth.getSession();
          if (error || data.session?.user.id !== ownerId) return null;
          return data.session.access_token;
        },
        apiBaseUrl
      );
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !error) applySession(data.session);
    }).catch((error: unknown) => {
      console.error('Unable to restore sponsor analytics session:', error);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      removeListeners?.();
    };
  }, [apiBaseUrl, getAccessToken, userId]);

  return null;
}
