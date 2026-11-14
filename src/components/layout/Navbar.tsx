'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { NotificationBell } from './NotificationBell';
import { NavbarView } from './NavbarView';

export function Navbar() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  return (
    <NavbarView
      pathname={pathname}
      isAuthenticated={isAuthenticated}
      renderNotifications={(props) => <NotificationBell {...props} />}
    />
  );
}
