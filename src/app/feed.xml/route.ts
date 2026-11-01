import { topics } from '@/data/topics';
import { siteConfig } from '@/lib/constants';

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function GET() {
  const baseUrl = siteConfig.url.replace(/\/+$/, '');
  const items = topics
    .map((topic) => {
      const url = `${baseUrl}/topic/${encodeURIComponent(topic.slug)}`;

      return `
    <item>
      <title>${escapeXml(topic.question)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <category>${escapeXml(topic.category)}</category>
      <description>${escapeXml(`${topic.answer} ${topic.explanation}`)}</description>
    </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(siteConfig.name)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(siteConfig.description)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(`${baseUrl}/feed.xml`)}" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom" />
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
