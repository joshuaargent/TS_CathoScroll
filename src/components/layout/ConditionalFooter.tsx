'use client';

import { usePathname } from 'next/navigation';
import { Footer } from '@/components/layout/Footer';

export function ConditionalFooter() {
  const pathname = usePathname();

  const hideFooterRoutes = ['/', '/search', '/categories'];

  if (hideFooterRoutes.includes(pathname)) {
    return null;
  }

  return <Footer />;
}
