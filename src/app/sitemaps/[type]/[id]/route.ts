import {
  getPublicProfileCount,
  getPublicProfileRange,
  getPublishedCategories,
  getPublishedTopicCount,
  getPublishedTopicRange,
} from '@/lib/content';
import { getSitemapCategoriesXml, isSitemapPageInRange, sitemapUrlsPerFile, xmlEscape } from '@/lib/sitemap';
import { siteConfig } from '@/lib/constants';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ type: string; id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const rateLimit = await checkTrustedIpRateLimit(request, 'sitemap:segment:ip', 60, 60);
  if (rateLimit && !rateLimit.allowed) {
    return new Response('Too many sitemap requests.', {
      status: rateLimit.unavailable ? 503 : 429,
      headers: {
        'Cache-Control': 'private, no-store',
        ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      },
    });
  }

  const { type, id } = await params;
  const pageStr = id.replace(/\.xml$/, '');
  const page = Number(pageStr);

  if (!['topics', 'profiles', 'static'].includes(type) || !/^\d+$/.test(pageStr) || !Number.isSafeInteger(page)) {
    return new Response('Not found.', { status: 404 });
  }

  try {
    const baseUrl = siteConfig.url.replace(/\/+$/, '');
    let urls: string[];

    if (type === 'static') {
      if (!isSitemapPageInRange(page, 1, sitemapUrlsPerFile)) {
        return new Response('Not found.', { status: 404 });
      }
      const categories = await getPublishedCategories();
      urls = getSitemapCategoriesXml(categories);
    } else if (type === 'topics') {
      const totalItems = await getPublishedTopicCount();
      if (!isSitemapPageInRange(page, totalItems)) {
        return new Response('Not found.', { status: 404 });
      }
      const topics = await getPublishedTopicRange(page * sitemapUrlsPerFile, sitemapUrlsPerFile);
      urls = topics.map((topic) => `${baseUrl}/topic/${encodeURIComponent(topic.slug)}`);
    } else {
      const totalItems = await getPublicProfileCount();
      if (!isSitemapPageInRange(page, totalItems)) {
        return new Response('Not found.', { status: 404 });
      }
      const profiles = await getPublicProfileRange(page * sitemapUrlsPerFile, sitemapUrlsPerFile);
      urls = profiles.map((username) => `${baseUrl}/profile/${encodeURIComponent(username)}`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`).join('\n  ')}
</urlset>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Unable to generate sitemap segment:', error);
    return new Response('Unable to generate sitemap segment.', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}   