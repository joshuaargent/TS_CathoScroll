import Link from 'next/link';

import {
  CommentBanAppealForm,
  type CommentBanAppealSubmitter,
} from '@/components/comments/CommentBanAppealForm';

export function CommentBanAppealPageView({
  banCreatedAt,
  pendingAppealCreatedAt,
  loading = false,
  error = '',
  submitter,
  onRetry,
}: {
  banCreatedAt: string | null;
  pendingAppealCreatedAt: string | null;
  loading?: boolean;
  error?: string;
  submitter?: CommentBanAppealSubmitter;
  onRetry?: () => void;
}) {
  return (
    <main className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Request a review</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Ask the CathoScroll team to review your comment restriction.
        </p>
      </section>

      <section className="mx-auto max-w-2xl">
        {loading ? (
          <p role="status" className="text-text-secondary">Loading your appeal details…</p>
        ) : error ? (
          <div className="border-border rounded-2xl border p-6">
            <p role="alert">{error}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="text-accent mt-4 underline">
                Try again
              </button>
            )}
          </div>
        ) : !banCreatedAt ? (
          <article className="border-border rounded-2xl border p-6">
            <h2 className="text-xl font-bold">No active restriction</h2>
            <p className="text-text-secondary mt-2">
              There is no active comment restriction on your account.
            </p>
            <Link href="/account" className="text-accent mt-4 inline-block hover:underline">
              Return to your account
            </Link>
          </article>
        ) : pendingAppealCreatedAt ? (
          <article className="border-border rounded-2xl border p-6">
            <h2 className="text-xl font-bold">Your request is waiting for review</h2>
            <p className="text-text-secondary mt-2">
              Submitted {new Date(pendingAppealCreatedAt).toLocaleDateString('en-GB')}. An admin will
              review your request and comment history. Only the moderation team can see your appeal.
            </p>
          </article>
        ) : (
          <div className="space-y-6">
            <article className="border-border rounded-2xl border p-6">
              <p className="text-text-secondary">
                Your account can still read discussions and use other site features; only posting
                and replying to comments is restricted. Explain why you think the restriction should
                be reviewed. An admin will see your comment history, including the comments you
                replied to.
              </p>
            </article>
            <CommentBanAppealForm submitter={submitter} />
          </div>
        )}
      </section>
    </main>
  );
}
