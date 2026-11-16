import { NavbarView } from '@/components/layout/NavbarView';
import { NativeNotificationBell } from './notifications';

export function NativeNavbar({ pathname, userId }: { pathname: string; userId: string | null }) {
  return (
    <NavbarView
      pathname={pathname}
      isAuthenticated={Boolean(userId)}
      showSpacer={true}
      renderNotifications={(props) =>
        userId ? (
          <NativeNotificationBell key={userId} userId={userId} pathname={pathname} {...props} />
        ) : null
      }
    />
  );
}
