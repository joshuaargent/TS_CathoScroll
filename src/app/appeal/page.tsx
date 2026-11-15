import { redirect } from 'next/navigation';

import { CommentBanAppealPageView } from '@/components/comments/CommentBanAppealPageView';
import { createClient } from '@/lib/supabase/server';

export default async function CommentBanAppealPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/signin?next=%2Fappeal');

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
    <CommentBanAppealPageView
      banCreatedAt={ban?.created_at ?? null}
      pendingAppealCreatedAt={appeal?.created_at ?? null}
    />
  );
}
