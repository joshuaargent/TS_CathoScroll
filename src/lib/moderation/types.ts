export interface AdminProfileSummary {
  id: string;
  username: string;
  display_name: string;
}

export interface AdminCommentReport {
  id: number;
  reporter_id: string;
  comment_id: number;
  reason: string;
  details: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reporter: AdminProfileSummary | null;
  comment: {
    content: string;
    is_deleted: boolean;
    topicTitle: string;
    topicSlug: string | null;
    author: AdminProfileSummary | null;
    isAuthorCommentBanned: boolean;
    authorBanReason: string | null;
  } | null;
}

export interface AdminCommentBanAppeal {
  id: number;
  user_id: string;
  ban_id: number;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  profile: AdminProfileSummary | null;
  banReason: string | null;
}

export interface AdminUserComment {
  id: number;
  content: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  parent_id: number | null;
  topicTitle: string;
  profile: AdminProfileSummary | null;
  parent: {
    content: string;
    profile: AdminProfileSummary | null;
  } | null;
}
