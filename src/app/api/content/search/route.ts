import { NextResponse } from 'next/server';

import { searchPublishedTopics } from '@/lib/content';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (query.length > 120) {
    return NextResponse.json({ error: 'Search query is too long.' }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchPublishedTopics(query, 30);
    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    console.error('Unable to search the public topic catalog:', error);
    return NextResponse.json(
      { error: 'Topic search is temporarily unavailable.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
