import { CommentBanAppealPageView } from '@/components/comments/CommentBanAppealPageView';
import { NativeAppealSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <CommentBanAppealPageView
      banCreatedAt={null}
      pendingAppealCreatedAt={null}
      loading
      loadingContent={<NativeAppealSkeleton />}
    />
  );
}
