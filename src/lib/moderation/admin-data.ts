import { topics } from '@/data/topics';
import type { AdminCommentBanAppeal, AdminCommentReport } from '@/lib/moderation/types';

const profileFields = 'id,username,display_name';

export async function loadCommentReports(
  adminClient: ReturnType<typeof import('@/lib/supabase/admin').createServiceRoleClient>,
  offset: number,
  pageSize: number
) {
  const { data: reportRows, error: reportsError } = await adminClient
    .from('comment_reports')
    .select('id,reporter_id,comment_id,reason,details,status,admin_note,created_at,reviewed_at')
    .order('created_at', { ascending: false })
    // Supabase range endpoints are inclusive; request one extra row to decide
    // whether the admin page should render a next-page link.
    .range(offset, offset + pageSize);

  if (reportsError) {
    throw new Error(`Unable to load comment reports: ${reportsError.message}`);
  }

  const hasNext = (reportRows ?? []).length > pageSize;
  const rows = (reportRows ?? []).slice(0, pageSize);
  const commentIds = [...new Set(rows.map((report) => report.comment_id))];
  const profileIds = [...new Set(rows.map((report) => report.reporter_id))];
  const [
    { data: comments, error: commentsError },
    { data: reporterProfiles, error: profilesError },
  ] = await Promise.all([
    commentIds.length
      ? adminClient
          .from('comments')
          .select('id,user_id,content,is_deleted,topic_id')
          .in('id', commentIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? adminClient.from('profiles').select(profileFields).in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (commentsError || profilesError) {
    throw new Error(
      `Unable to load report context: ${commentsError?.message ?? profilesError?.message}`
    );
  }

  const authorIds = [...new Set((comments ?? []).map((comment) => comment.user_id))];
  const { data: authorProfiles, error: authorProfilesError } = authorIds.length
    ? await adminClient.from('profiles').select(profileFields).in('id', authorIds)
    : { data: [], error: null };

  if (authorProfilesError) {
    throw new Error(`Unable to load reported-user profiles: ${authorProfilesError.message}`);
  }

  const { data: activeBans, error: activeBansError } = authorIds.length
    ? await adminClient
        .from('user_comment_bans')
        .select('user_id,reason')
        .in('user_id', authorIds)
        .is('unbanned_at', null)
    : { data: [], error: null };

  if (activeBansError) {
    throw new Error(`Unable to load reported-user restrictions: ${activeBansError.message}`);
  }

  const commentById = new Map((comments ?? []).map((comment) => [comment.id, comment]));
  const profileById = new Map(
    [...(reporterProfiles ?? []), ...(authorProfiles ?? [])].map((profile) => [profile.id, profile])
  );
  const banByUserId = new Map((activeBans ?? []).map((ban) => [ban.user_id, ban]));
  // Resolve each report against maps built from its batched comment/profile
  // queries rather than issuing one database request per report.
  // AQA-style pseudocode:
  // FOR EACH report
  //   FIND comment, reporter and author in maps
  //   ADD topic and active restriction context
  // Time is O(r + c + p) on average due to hash-map lookups.
  const reports: AdminCommentReport[] = rows.map((report) => {
    const comment = commentById.get(report.comment_id);
    const author = comment ? (profileById.get(comment.user_id) ?? null) : null;
    const activeBan = comment ? banByUserId.get(comment.user_id) : null;

    return {
      ...report,
      reporter: profileById.get(report.reporter_id) ?? null,
      comment: comment
        ? {
            content: comment.content,
            is_deleted: comment.is_deleted,
            topicTitle:
              topics.find((topic) => String(topic.id) === String(comment.topic_id))?.question ??
              'Unknown topic',
            topicSlug:
              topics.find((topic) => String(topic.id) === String(comment.topic_id))?.slug ?? null,
            author,
            isAuthorCommentBanned: Boolean(activeBan),
            authorBanReason: activeBan?.reason ?? null,
          }
        : null,
    };
  });

  return { items: reports, hasNext };
}

export async function loadCommentBanAppeals(
  adminClient: ReturnType<typeof import('@/lib/supabase/admin').createServiceRoleClient>,
  offset: number,
  pageSize: number
) {
  const { data: appealRows, error: appealsError } = await adminClient
    .from('comment_ban_appeals')
    .select('id,user_id,ban_id,message,status,admin_note,created_at')
    .order('created_at', { ascending: false })
    // Fetch one look-ahead row because PostgREST ranges include both endpoints.
    .range(offset, offset + pageSize);

  if (appealsError) {
    throw new Error(`Unable to load comment-ban appeals: ${appealsError.message}`);
  }

  const hasNext = (appealRows ?? []).length > pageSize;
  const rows = (appealRows ?? []).slice(0, pageSize);
  const userIds = [...new Set(rows.map((appeal) => appeal.user_id))];
  const banIds = [...new Set(rows.map((appeal) => appeal.ban_id))];
  const [{ data: profiles, error: profilesError }, { data: bans, error: bansError }] =
    await Promise.all([
      userIds.length
        ? adminClient.from('profiles').select(profileFields).in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      banIds.length
        ? adminClient.from('user_comment_bans').select('id,reason').in('id', banIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (profilesError || bansError) {
    throw new Error(
      `Unable to load appeal context: ${profilesError?.message ?? bansError?.message}`
    );
  }

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const banReasonById = new Map((bans ?? []).map((ban) => [ban.id, ban.reason]));
  // Enrich each appeal with its user and original restriction using indexed
  // map lookups, avoiding an extra query for every appeal in the page.
  const appeals: AdminCommentBanAppeal[] = rows.map((appeal) => ({
    ...appeal,
    profile: profileById.get(appeal.user_id) ?? null,
    banReason: banReasonById.get(appeal.ban_id) ?? null,
  }));

  return { items: appeals, hasNext };
}
