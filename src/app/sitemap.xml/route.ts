import { getPublicProfileCount, getPublishedTopicCount } from '@/lib/content';
import { siteConfig } from '@/lib/constants';
import { sitemapUrlsPerFile, xmlEscape } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [topicCount, profileCount] = await Promise.all([
      getPublishedTopicCount(),
      getPublicProfileCount(),
    ]);
    const baseUrl = siteConfig.url.replace(/\/+$/, '');
    const topicSitemaps = Math.max(1, Math.ceil(topicCount / sitemapUrlsPerFile));
    const profileSitemaps = Math.ceil(profileCount / sitemapUrlsPerFile);
    const sitemapUrls = [
      `${baseUrl}/sitemaps/static/0.xml`,
      ...Array.from(
        { length: topicSitemaps },
        (_, page) => `${baseUrl}/sitemaps/topics/${page}.xml`
      ),
      ...Array.from(
        { length: profileSitemaps },
        (_, page) => `${baseUrl}/sitemaps/profiles/${page}.xml`
      ),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemapUrls.map((url) => `<sitemap><loc>${xmlEscape(url)}</loc></sitemap>`).join('\n  ')}
</sitemapindex>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Unable to generate sitemap index:', error);
    return new Response('Unable to generate sitemap.', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
