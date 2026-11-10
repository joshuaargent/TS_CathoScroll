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
    '/learn',
    '/about',
    '/faq',
    '/contact',
    '/privacy',
    '/terms',
    '/cookies',
  ].map((path) => `${baseUrl}${path}`);

  return [...staticUrls, ...categoryUrls];
}
