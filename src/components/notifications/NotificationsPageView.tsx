import type { ReactNode } from 'react';

export function NotificationsPageView({ children }: { children: ReactNode }) {
  return (
    <main className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Notifications</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Replies, moderation updates, and other important account messages appear here.
        </p>
      </section>
      <section className="max-w-3xl">{children}</section>
    </main>
  );
}
