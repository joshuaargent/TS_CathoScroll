import type { Metadata } from 'next';

import { redirect } from 'next/navigation';

import { NotificationsPageView } from '@/components/notifications/NotificationsPageView';
import { NotificationList } from '@/components/notifications/NotificationList';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin?next=%2Fnotifications');

  return (
    <NotificationsPageView>
      <NotificationList />
    </NotificationsPageView>
  );
}
