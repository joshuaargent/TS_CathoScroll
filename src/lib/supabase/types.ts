export interface Profile {
  id: string;

  username: string;

  display_name: string;

  bio: string | null;

  created_at: string;

  subscription_tier: 'free' | 'premium';
}

export interface Comment {
  id: number;

  user_id: string;

  topic_id: string;

  parent_id: number | null;

  content: string;

  created_at: string;

  edited_at: string | null;

  is_deleted: boolean;

  is_pinned: boolean;

  profile: Profile;

  likes: number;

  likedByUser: boolean;

  // Built from parent_id after fetching flat database rows; not a separate
  // stored field. This recursive shape lets the UI render reply branches.
  replies: Comment[];

  optimistic?: boolean;
}
