'use client';

import { Bell, CheckCheck, MessageCircle, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { topics } from '@/data/topics';

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  topic_id: string | null;
  comment_id: number | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationResponse {
  notifications?: Notification[];
  unreadCount?: number;
  error?: string;
}

function getNotificationIcon(type: string) {
  if (type === 'reply') {
    return <MessageCircle className="text-accent h-5 w-5" aria-hidden="true" />;
  }

  if (type === 'welcome') {
    return <Sparkles className="text-accent h-5 w-5" aria-hidden="true" />;
  }

  if (type.includes('report') || type.includes('comment_hidden')) {
    return <ShieldAlert className="text-accent h-5 w-5" aria-hidden="true" />;
  }

  return <Bell className="text-accent h-5 w-5" aria-hidden="true" />;
}

function getNotificationHref(notification: Notification) {
  if (notification.type === 'comment_restricted' || notification.type === 'comment_banned') {
    return '/appeal';
  }

  if (notification.topic_id) {
    const topic = topics.find((item) => String(item.id) === notification.topic_id);
    if (topic) {
      return `/topic/${topic.slug}#comments`;
    }
  }

  return '/notifications';
}

function formatNotificationDate(dateString: string) {
  return new Date(dateString).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationList() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | 'all' | null>(null);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async () => {
    setError('');

    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const result = (await response.json()) as NotificationResponse;

      if (!response.ok) {
        throw new Error(result.error ?? 'Unable to load notifications.');
      }

      setNotifications(result.notifications ?? []);
      setUnreadCount(result.unreadCount ?? 0);
    } catch (loadError) {
      console.error('Unable to load notifications:', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load notifications. Please retry.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load asynchronously so notification state reflects the server-side RLS view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNotifications();
  }, [loadNotifications]);

  async function markAsRead(notificationId: number | 'all') {
    setSavingId(notificationId);
    setError('');

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          notificationId === 'all' ? { action: 'read_all' } : { action: 'read', notificationId }
        ),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? 'Unable to update notification.');
      }

      const readAt = new Date().toISOString();
      // Reconcile the visible list immutably after the server confirms the
      // read-state update. This scans at most the 50 displayed notifications.
      setNotifications((current) =>
        current.map((notification) =>
          notificationId === 'all' || notification.id === notificationId
            ? { ...notification, read_at: notification.read_at ?? readAt }
            : notification
        )
      );
      setUnreadCount((current) =>
        notificationId === 'all'
          ? 0
          : Math.max(
              0,
              current -
                (notifications.find((notification) => notification.id === notificationId)?.read_at
                  ? 0
                  : 1)
            )
      );
      window.dispatchEvent(new Event('cathoscroll:notifications-changed'));
    } catch (updateError) {
      console.error('Unable to mark notification as read:', updateError);
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Unable to update notification. Please retry.'
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void markAsRead('all')}
            disabled={savingId !== null}
            className="text-accent inline-flex items-center gap-2 text-sm font-medium hover:underline disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            {savingId === 'all' ? 'Marking read...' : 'Mark all as read'}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => void loadNotifications()}
            className="mt-2 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <article className="border-border rounded-2xl border p-6">
          <p className="text-text-secondary">Loading notifications...</p>
        </article>
      ) : notifications.length === 0 ? (
        <article className="border-border rounded-2xl border p-8 text-center">
          <Bell className="text-text-muted mx-auto h-8 w-8" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold">You’re all caught up</h2>
          <p className="text-text-secondary mt-2">
            Replies and important account updates will appear here.
          </p>
        </article>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const href = getNotificationHref(notification);
            const isSaving = savingId === notification.id;

            return (
              <article
                key={notification.id}
                className={`border-border rounded-2xl border p-5 transition-colors ${
                  notification.read_at ? '' : 'bg-accent-light/10'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="bg-bg-secondary mt-0.5 rounded-full p-2">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="font-bold">{notification.title}</h2>
                      {!notification.read_at && (
                        <span className="bg-accent mt-1 h-2 w-2 rounded-full" aria-label="Unread" />
                      )}
                    </div>
                    <p className="text-text-secondary mt-2 text-sm whitespace-pre-wrap">
                      {notification.body}
                    </p>
                    <p className="text-text-muted mt-3 text-xs">
                      {formatNotificationDate(notification.created_at)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-4">
                      <Link
                        href={href}
                        onClick={() => {
                          if (!notification.read_at) {
                            void markAsRead(notification.id);
                          }
                        }}
                        className="text-accent text-sm font-medium hover:underline"
                      >
                        {href === '/notifications' ? 'View notification' : 'View'}
                      </Link>
                      {!notification.read_at && (
                        <button
                          type="button"
                          onClick={() => void markAsRead(notification.id)}
                          disabled={isSaving}
                          className="text-text-secondary text-sm hover:underline disabled:opacity-50"
                        >
                          {isSaving ? 'Saving...' : 'Mark as read'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
