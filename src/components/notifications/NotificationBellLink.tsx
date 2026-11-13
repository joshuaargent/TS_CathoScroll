import { Bell } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function NotificationBellLink({
  unreadCount,
  hasCountError,
  className,
  showLabel = false,
  onNavigate,
}: {
  unreadCount: number;
  hasCountError: boolean;
  className?: string;
  showLabel?: boolean;
  onNavigate?: () => void;
}) {
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
      <Bell className="text-text-primary h-5 w-5" aria-hidden="true" />
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
