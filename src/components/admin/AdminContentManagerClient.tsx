'use client';

import { useRouter } from 'next/navigation';
import {
  AdminContentManager,
  type AdminContentCategory,
  type AdminContentTopic,
} from './AdminContentManager';

export function AdminContentManagerClient({
  categories,
  topics,
}: {
  categories: AdminContentCategory[];
  topics: AdminContentTopic[];
}) {
  const router = useRouter();
  return (
    <AdminContentManager
      categories={categories}
      topics={topics}
      onSaved={() => router.refresh()}
    />
  );
}
