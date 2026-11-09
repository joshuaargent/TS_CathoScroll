'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/providers/AuthProvider';
import { cn } from '@/lib/utils';

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

  // Keep the visual count compact while exposing the exact unread total to
  // assistive technology.
  // AQA-style pseudocode:
  // IF unreadCount = 0 THEN show no badge
  // ELSE IF unreadCount >= 10 THEN show "9+"
  // ELSE show unreadCount
  const badgeLabel = unreadCount >= 10 ? '9+' : String(unreadCount);
  const accessibleLabel =
    unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : hasCountError
        ? 'Notifications, unread count unavailable'
        : 'Notifications';

  return (
    <Link
      href="/notifications"
      onClick={onNavigate}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={cn(
        'text-text-primary hover:bg-bg-secondary relative inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
        className
      )}
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {showLabel && <span className="text-sm font-medium">Notifications</span>}
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'bg-accent absolute -top-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-white',
            showLabel && 'top-0 right-1'
          )}
        >
          {badgeLabel}
        </span>
      )}
    </Link>
  );
}
