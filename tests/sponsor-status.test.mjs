import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [bootstrap, route, manager] = await Promise.all([
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsors/[sponsorId]/status/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/SponsorManager.tsx', import.meta.url), 'utf8'),
]);

test('sponsor status changes are administrator-only, audited and constrained', () => {
  const start = bootstrap.lastIndexOf('CREATE OR REPLACE FUNCTION public.admin_set_sponsor_status');
  assert.notEqual(start, -1);
  const end = bootstrap.indexOf('$function$;', start);
  assert.notEqual(end, -1);
  const body = bootstrap.slice(start, end + '$function$;'.length);
  assert.match(body, /public\.admin_users/);
  assert.match(body, /draft', 'scheduled', 'active', 'paused', 'completed/);
  assert.match(body, /sponsor\.status_changed/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION public\.admin_set_sponsor_status\(uuid, uuid, text\) TO service_role/);
});

test('status API enforces administrator role, same-origin and rate limiting without MFA', () => {
  assert.match(route, /getAdminSessionFromRequest/);
  assert.doesNotMatch(route, /mfaRequired|administrator MFA|account\/security/);
  assert.match(route, /isSameOriginOrNativeRequest/);
  assert.match(route, /checkApiRateLimit/);
  assert.match(route, /admin_set_sponsor_status/);
});

test('admin sponsor manager exposes organisation pause and resume statuses', () => {
  for (const status of ['draft', 'scheduled', 'active', 'paused', 'completed']) {
    assert.match(manager, new RegExp(`<option value="${status}">`));
  }
  assert.match(manager, /Update status/);
  assert.match(manager, /\/api\/admin\/sponsors/);
});
