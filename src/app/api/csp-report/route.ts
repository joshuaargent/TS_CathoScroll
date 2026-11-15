import { NextResponse } from 'next/server';

import { readBoundedJson } from '@/lib/http/read-json';
import { checkTrustedIpRateLimit, rateLimitResponseHeaders } from '@/lib/security/api-rate-limit';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

  let report: unknown = parsed.value;
  if (isRecord(report) && 'csp-report' in report) report = report['csp-report'];
  if (Array.isArray(report)) report = report[0];
  if (!isRecord(report)) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const record = isRecord(report.body) ? report.body : report;
  const lineNumber = record['line-number'] ?? record.lineNumber;
  const safeReport = {
    documentUri: safeText(record['document-uri'] ?? record.documentURL),
    blockedUri: safeText(record['blocked-uri'] ?? record.blockedURL),
    violatedDirective: safeText(record['violated-directive'] ?? record.effectiveDirective),
    sourceFile: safeText(record['source-file'] ?? record.sourceFile),
    lineNumber: typeof lineNumber === 'number' ? lineNumber : null,
    disposition: safeText(record.disposition, 40),
  };

  console.warn('CSP report-only violation:', safeReport);
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
