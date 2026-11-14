import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NotificationBellLink } from '@/components/notifications/NotificationBellLink';
import { NotificationList } from '@/components/notifications/NotificationList';
import { createClient } from './supabase';
import { notificationTransport } from './notification-operations';
import { NotificationCache } from './notification-cache';
import { NativeNotificationService } from './notification-service';
import { openPrivateActivityDatabase } from '@/lib/offline/native-database';
import { secureAuthStorage } from './secure-auth-storage';

type NotificationState = {
  userId: string;
  service: NativeNotificationService | null;
  error: string;
};
const NotificationContext = createContext<NotificationState | null>(null);

export function NativeNotificationsProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<NotificationState | null>(null);
  useEffect(() => {
    if (!userId) return;
    const accountId = userId;
    let active = true;
    let service: NativeNotificationService | null = null;
    const request = () => {
      if (!service) return;
      void service.sync().catch((error: unknown) => {
        console.error('Unable to synchronize notification changes:', error);
      });
    };
    async function start() {
      try {
        const cache = new NotificationCache(await openPrivateActivityDatabase(secureAuthStorage));
        await cache.initialize();
        if (!active) return;
        service = new NativeNotificationService(
          accountId,
          cache,
          notificationTransport(createClient(), accountId)
        );
        setState({ userId: accountId, service, error: '' });
        request();
      } catch (error) {
        console.error('Unable to open saved notifications:', error);
        if (active)
          setState({
            userId: accountId,
            service: null,
            error: 'Saved notifications could not be opened.',
          });
      }
    }
    void start();
    window.addEventListener('online', request);
    window.addEventListener('focus', request);
    const timer = window.setInterval(request, 60_000);
    return () => {
      active = false;
      window.removeEventListener('online', request);
      window.removeEventListener('focus', request);
      window.clearInterval(timer);
    };
  }, [userId]);

  const current = state?.userId === userId ? state : null;
  return <NotificationContext.Provider value={current}>{children}</NotificationContext.Provider>;
}

export function useNativeNotifications() {
  return useContext(NotificationContext);
}

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
  const state = useNativeNotifications();
  const transport = state?.userId === userId ? state.service : null;
  const storageError = state?.error;
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasCountError, setHasCountError] = useState(false);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      if (!transport) throw new Error(storageError || 'Saved notifications are loading.');
      const count = await transport.unreadCount();
      if (version !== requestVersion.current) return;
      setUnreadCount(count);
      setHasCountError(false);
    } catch (error) {
      if (version !== requestVersion.current) return;
      console.error('Unable to refresh notification count:', error);
      setHasCountError(true);
    }
  }, [transport, storageError]);

  useEffect(() => {
    let active = true;
    const versions = requestVersion;
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
      versions.current++;
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
  const state = useNativeNotifications();
  const transport = state?.userId === userId ? state.service : null;
  return (
    <div className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Notifications</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Replies, moderation updates, and other important account messages appear here.
        </p>
      </section>
      <section className="max-w-3xl">
        {!userId ? (
          <p>Sign in to view notifications.</p>
        ) : transport ? (
          <NotificationList transport={transport} />
        ) : state?.error ? (
          <p role="alert">{state.error}</p>
        ) : (
          <p role="status">Loading notifications...</p>
        )}
      </section>
    </div>
  );
}
