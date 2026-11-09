import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CommentBanAppealForm } from '@/components/comments/CommentBanAppealForm';
import { createClient } from '@/lib/supabase/server';

export default async function CommentBanAppealPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?next=%2Fappeal');
  }

  const [{ data: ban, error: banError }, { data: appeal, error: appealError }] = await Promise.all([
    supabase
      .from('user_comment_bans')
      .select('id,created_at')
      .eq('user_id', user.id)
      .is('unbanned_at', null)
      .maybeSingle(),
    supabase
      .from('comment_ban_appeals')
      .select('id,status,created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle(),
  ]);

  if (banError || appealError) {
    console.error(
      'Unable to load comment-ban appeal details:',
      banError?.message,
      appealError?.message
    );
    throw new Error('Unable to load your appeal details. Please try again later.');
  }

  return (
    <main className="container py-12">
      <section className="mt-8 mb-10">
        <h1 className="text-5xl font-extrabold md:text-7xl">Request a review</h1>
        <p className="text-text-secondary mt-4 max-w-2xl text-lg">
          Ask the CathoScroll team to review your comment restriction.
        </p>
      </section>

      <section className="mx-auto max-w-2xl">
        {!ban ? (
          <article className="border-border rounded-2xl border p-6">
            <h2 className="text-xl font-bold">No active restriction</h2>
            <p className="text-text-secondary mt-2">
              There is no active comment restriction on your account.
            </p>
            <Link href="/account" className="text-accent mt-4 inline-block hover:underline">
              Return to your account
            </Link>
          </article>
        ) : appeal ? (
          <article className="border-border rounded-2xl border p-6">
            <h2 className="text-xl font-bold">Your request is waiting for review</h2>
            <p className="text-text-secondary mt-2">
              Submitted {new Date(appeal.created_at).toLocaleDateString('en-GB')}. An admin will
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
            <CommentBanAppealForm />
          </div>
        )}
      </section>
    </main>
  );
}
