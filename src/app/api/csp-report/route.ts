import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function safeText(value: unknown, maximum = 500): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, maximum);
}

export async function POST(request: Request) {
  const rateLimit = await checkTrustedIpRateLimit(request, 'csp-report:ip', 60, 60);
  if (rateLimit && !rateLimit.allowed) {
    return new NextResponse(null, {
      status: rateLimit.unavailable ? 503 : 429,
      headers: {
        'Cache-Control': 'no-store',
        ...rateLimitResponseHeaders(rateLimit.retryAfterSeconds),
      },
    });
  }

  const parsed = await readBoundedJson(request, 16_384);
  if (!parsed.ok) {
    return new NextResponse(null, {
      status: parsed.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const payload = parsed.value;
  const legacy =
    typeof payload === 'object' && payload !== null && 'csp-report' in payload
      ? payload['csp-report']
      : payload;
  const report =
    Array.isArray(legacy) ? legacy[0] : legacy;

  if (typeof report !== 'object' || report === null) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const record =
    'body' in report && typeof report.body === 'object' && report.body !== null
      ? report.body
      : report;

  const safeReport = {
    documentUri: safeText('document-uri' in record ? record['document-uri'] : record['documentURL']),
    blockedUri: safeText('blocked-uri' in record ? record['blocked-uri'] : record['blockedURL']),
    violatedDirective: safeText('violated-directive' in record ? record['violated-directive'] : record['effectiveDirective']),
    sourceFile: safeText('source-file' in record ? record['source-file'] : record['sourceFile']),
    lineNumber:
      typeof ('line-number' in record ? record['line-number'] : record['lineNumber']) === 'number'
        ? ('line-number' in record ? record['line-number'] : record['lineNumber'])
        : null,
    disposition: safeText('disposition' in record ? record.disposition : null, 40),
  };

  console.warn('CSP report-only violation:', safeReport);
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
