import { NextResponse } from 'next/server';

import { getPublishedTopicPage } from '@/lib/content';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
};

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const afterOrder = searchParams.get('afterOrder');
  const afterId = searchParams.get('afterId');
  const categorySlug = searchParams.get('category');
  const requestedLimit = Number(searchParams.get('limit') ?? '30');

  if (
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 50 ||
    (afterOrder === null) !== (afterId === null) ||
    (afterOrder !== null &&
      (!/^\d+$/.test(afterOrder) || !/^[a-zA-Z0-9-]{1,100}$/.test(afterId!))) ||
    (categorySlug !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug))
  ) {
    return NextResponse.json({ error: 'Invalid topic page request.' }, { status: 400 });
  }

  try {
    const page = await getPublishedTopicPage({
      limit: requestedLimit,
      ...(categorySlug ? { categorySlug } : {}),
      ...(afterOrder !== null && afterId !== null
        ? { cursor: { orderIndex: Number(afterOrder), id: afterId } }
        : {}),
    });

    return NextResponse.json(page, { headers: cacheHeaders });
  } catch (error) {
    console.error('Unable to load public topic page:', error);
    return NextResponse.json(
      { error: 'Unable to load topics. Please try again.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
