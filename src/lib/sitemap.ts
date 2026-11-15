import { siteConfig } from '@/lib/constants';

export const sitemapUrlsPerFile = 40_000;

export function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function getSitemapCategoriesXml(categories: { slug: string }[]) {
  const baseUrl = siteConfig.url.replace(/\/+$/, '');
  const categoryUrls = categories.map(
    ({ slug }) => `${baseUrl}/categories/${encodeURIComponent(slug)}`
  );
  const staticUrls = [
    '/',
    '/categories',
    '/download',
    '/about',
    '/faq',
    '/contact',
    '/privacy',
    '/terms',
    '/cookies',
  ].map((path) => `${baseUrl}${path}`);

  return [...staticUrls, ...categoryUrls];
}

export function isSitemapPageInRange(
  page: number,
  totalItems: number,
  itemsPerPage = sitemapUrlsPerFile
): boolean {
  return (
    Number.isSafeInteger(page) &&
    page >= 0 &&
    Number.isSafeInteger(totalItems) &&
    totalItems >= 0 &&
    Number.isSafeInteger(itemsPerPage) &&
    itemsPerPage > 0 &&
    page <= Math.floor(Number.MAX_SAFE_INTEGER / itemsPerPage) &&
    page < Math.ceil(totalItems / itemsPerPage)
  );
}
