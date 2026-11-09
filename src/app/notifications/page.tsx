import { redirect } from 'next/navigation';

import { NotificationList } from '@/components/notifications/NotificationList';
import { createClient } from '@/lib/supabase/server';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?next=%2Fnotifications');
  }

  return (
    <main className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Notifications</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Replies, moderation updates, and other important account messages appear here.
        </p>
      </section>

      <section className="max-w-3xl">
        <NotificationList />
      </section>
    </main>
  );
}
