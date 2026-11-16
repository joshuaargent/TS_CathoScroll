import { NotificationsPageView } from '@/components/notifications/NotificationsPageView';
import { NativeNotificationsSkeleton } from '../../../../native/skeletons';

export default function Loading() {
  return (
    <NotificationsPageView>
      <NativeNotificationsSkeleton />
    </NotificationsPageView>
  );
}
