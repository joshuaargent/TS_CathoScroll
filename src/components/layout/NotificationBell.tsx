'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/providers/AuthProvider';
import { NotificationBellLink } from '@/components/notifications/NotificationBellLink';

interface NotificationBellProps {
  className?: string;
  showLabel?: boolean;
  onNavigate?: () => void;
}

export function NotificationBell({
  className,
  showLabel = false,
  onNavigate,
}: NotificationBellProps) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasCountError, setHasCountError] = useState(false);

  const refreshUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setHasCountError(false);
      return;
    }

    try {
      const response = await fetch('/api/notifications?countOnly=1', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Notification count request failed (${response.status})`);
      }

      const result = (await response.json()) as { unreadCount: number };
      setUnreadCount(result.unreadCount);
      setHasCountError(false);
    } catch (error) {
      console.error('Unable to refresh notification count:', error);
      setHasCountError(true);
    }
  }, [user]);

  useEffect(() => {
    if (loading) {
      return;
    }

    // The effect starts asynchronous synchronization; the request updates state
    // only after it resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUnreadCount();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshUnreadCount();
      }
    }, 60_000);

    const handleFocus = () => {
      void refreshUnreadCount();
    };

    const handleNotificationChange = () => {
      void refreshUnreadCount();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('cathoscroll:notifications-changed', handleNotificationChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('cathoscroll:notifications-changed', handleNotificationChange);
    };
  }, [loading, pathname, refreshUnreadCount]);

  if (loading || !user) {
    return null;
  }

  return (
    <NotificationBellLink
      unreadCount={unreadCount}
      hasCountError={hasCountError}
      className={className}
      showLabel={showLabel}
      onNavigate={onNavigate}
    />
  );
}
