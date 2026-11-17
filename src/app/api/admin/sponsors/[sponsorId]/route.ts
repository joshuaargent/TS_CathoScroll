import { NextResponse } from 'next/server';

import { nativeApiCorsHeaders } from '@/lib/supabase/admin';

interface RouteContext {
  params: Promise<{ sponsorId: string }>;
}

function respond(request: Request, body: unknown, status: number) {
  const headers = nativeApiCorsHeaders(request);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  const headers = nativeApiCorsHeaders(request);
  if (!headers.has('Access-Control-Allow-Origin') && !headers.has('Vary')) {
    return new NextResponse(null, { status: 403 });
  }
  headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  return new NextResponse(null, { status: 204, headers });
}

export async function PATCH(request: Request, _context: RouteContext) {
  return respond(
    request,
    {
      error: 'Direct sponsor payment status changes are no longer supported. Create an invoice and record the bank transfer in Sponsor financials.',
    },
    410
  );
}
