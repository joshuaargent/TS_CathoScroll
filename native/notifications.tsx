import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotificationBellLink } from '@/components/notifications/NotificationBellLink';
import { NotificationList } from '@/components/notifications/NotificationList';
import { createClient } from './supabase';
import { notificationTransport } from './notification-operations';

export function NativeNotificationBell({
  userId,
  pathname,
  showLabel,
  onNavigate,
}: {
  userId: string;
  pathname: string;
  showLabel?: boolean;
  onNavigate?: () => void;
}) {
  const transport = useMemo(() => notificationTransport(createClient(), userId), [userId]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasCountError, setHasCountError] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const count = await transport.unreadCount();
      setUnreadCount(count);
      setHasCountError(false);
    } catch (error) {
      console.error('Unable to refresh notification count:', error);
      setHasCountError(true);
    }
  }, [transport]);

  useEffect(() => {
    let active = true;
    const request = () => {
      if (active) void refresh();
    };
    request();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') request();
    }, 60_000);
    window.addEventListener('focus', request);
    window.addEventListener('online', request);
    window.addEventListener('cathoscroll:notifications-changed', request);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      window.removeEventListener('cathoscroll:notifications-changed', request);
    };
  }, [pathname, refresh]);

  return (
    <NotificationBellLink
      unreadCount={unreadCount}
      hasCountError={hasCountError}
      showLabel={showLabel}
      className={
        showLabel
          ? 'border-border bg-bg-card hover:bg-bg-secondary h-auto w-full max-w-[16rem] justify-center gap-2 rounded-lg border px-4 py-2'
          : undefined
      }
      onNavigate={onNavigate}
    />
  );
}

export function NativeNotifications({ userId }: { userId: string | null }) {
  const transport = useMemo(
    () => (userId ? notificationTransport(createClient(), userId) : null),
    [userId]
  );
  return (
    <div className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Notifications</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Replies, moderation updates, and other important account messages appear here.
        </p>
      </section>
      <section className="max-w-3xl">
        {transport ? (
          <NotificationList transport={transport} />
        ) : (
          <p>Sign in to view notifications.</p>
        )}
      </section>
    </div>
  );
}
