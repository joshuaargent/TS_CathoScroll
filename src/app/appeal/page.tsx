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
      <section className="mx-auto mt-8 max-w-3xl">
        <h1 className="text-4xl font-extrabold md:text-5xl">Request a comment-ban review</h1>

        {!ban ? (
          <article className="border-border mt-8 rounded-2xl border p-6">
            <p className="text-text-secondary">
              There is no active comment restriction on your account.
            </p>
            <Link href="/account" className="text-accent mt-4 inline-block hover:underline">
              Return to your account
            </Link>
          </article>
        ) : appeal ? (
          <article className="border-border mt-8 rounded-2xl border p-6">
            <h2 className="text-xl font-bold">Your request is waiting for review</h2>
            <p className="text-text-secondary mt-2">
              Submitted {new Date(appeal.created_at).toLocaleDateString('en-GB')}. An admin will
              review your request and comment history.
            </p>
          </article>
        ) : (
          <div className="mt-8 space-y-6">
            <p className="text-text-secondary">
              Your account can still read discussions and use other site features; only posting and
              replying to comments is restricted. Explain why you think the restriction should be
              reviewed. An admin will see your comment history, including the comments you replied
              to.
            </p>
            <CommentBanAppealForm />
          </div>
        )}
      </section>
    </main>
  );
}
