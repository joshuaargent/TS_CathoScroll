import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  bootstrap,
  membershipRoute,
  sponsorPortalPage,
  sponsorPortal,
  campaignCreateRoute,
  campaignUpdateRoute,
] = await Promise.all([
  readFile(new URL('../docs/cathoscroll-database-bootstrap.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/admin/sponsors/[sponsorId]/members/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/sponsor/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/sponsor/SponsorPortal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/sponsor/campaigns/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/sponsor/campaigns/[campaignId]/route.ts', import.meta.url), 'utf8'),
]);

function functionBody(name) {
  const start = bootstrap.lastIndexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = bootstrap.indexOf('ALTER FUNCTION ', start);
  assert.notEqual(end, -1, `Missing ALTER FUNCTION after ${name}`);
  return bootstrap.slice(start, end);
}

test('sponsor memberships are private and support scoped organisation roles', () => {
  assert.match(bootstrap, /CREATE TABLE public\.sponsor_memberships/);
  assert.match(bootstrap, /REFERENCES public\.sponsors\(id\) ON DELETE CASCADE/);
  assert.match(bootstrap, /REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  assert.match(bootstrap, /CHECK \(role IN \('owner', 'manager', 'analyst'\)\)/);
  assert.match(bootstrap, /CHECK \(status IN \('active', 'suspended', 'revoked'\)\)/);
  assert.match(bootstrap, /ALTER TABLE public\.sponsor_memberships ENABLE ROW LEVEL SECURITY/);
  assert.match(bootstrap, /REVOKE ALL ON TABLE public\.sponsor_memberships FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(bootstrap, /GRANT SELECT ON TABLE public\.sponsor_memberships TO service_role/);
});

test('admin sponsor membership changes are audited and service-role-only', () => {
  const add = functionBody('public.admin_add_sponsor_member');
  const status = functionBody('public.admin_set_sponsor_member_status');
  const lookup = functionBody('public.admin_find_sponsor_user_by_email');
  assert.match(add, /public\.admin_users/);
  assert.match(add, /ON CONFLICT \(sponsor_id, user_id\) DO UPDATE/);
  assert.match(add, /sponsor\.member_added/);
  assert.match(status, /public\.admin_users/);
  assert.match(status, /'suspend', 'reactivate', 'revoke'/);
  assert.match(status, /sponsor\.member_/);
  assert.match(status, /last active sponsor owner cannot be suspended or revoked/);
  assert.match(lookup, /auth\.users/);
  assert.match(lookup, /lower\(users\.email\)/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION public\.admin_find_sponsor_user_by_email[^;]+TO service_role/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION public\.admin_add_sponsor_member[^;]+TO service_role/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION public\.admin_set_sponsor_member_status[^;]+TO service_role/);
});

test('sponsor campaign submission and editing are restricted to active managers', () => {
  const create = functionBody('public.sponsor_create_campaign');
  const update = functionBody('public.sponsor_update_campaign');
  assert.match(create, /membership\.status = 'active'/);
  assert.match(create, /membership\.role IN \('owner', 'manager'\)/);
  assert.match(create, /'pending_approval'/);
  assert.match(update, /membership\.status = 'active'/);
  assert.match(update, /membership\.role IN \('owner', 'manager'\)/);
  assert.match(update, /v_campaign\.status NOT IN \('draft', 'pending_approval', 'rejected'\)/);
  assert.match(update, /Approved or paused campaigns cannot be edited/);
});

test('sponsor analytics are aggregate-only and require active organisation membership', () => {
  const analytics = functionBody('public.get_sponsor_campaign_analytics');
  assert.match(analytics, /membership\.status = 'active'/);
  assert.match(analytics, /sponsor_campaign_daily/);
  assert.match(analytics, /click_through_rate/);
  assert.doesNotMatch(analytics, /user_id.*jsonb_build_object|session_id.*jsonb_build_object/);
});

test('admin account assignment resolves an existing Auth user and supports revocation', () => {
  assert.match(membershipRoute, /getAdminSessionFromRequest/);
  assert.match(membershipRoute, /admin_find_sponsor_user_by_email/);
  assert.match(membershipRoute, /No CathoScroll account exists/);
  assert.match(membershipRoute, /admin_add_sponsor_member/);
  assert.match(membershipRoute, /admin_set_sponsor_member_status/);
  assert.match(membershipRoute, /sponsor_memberships/);
  assert.match(membershipRoute, /checkApiRateLimit/);
  assert.doesNotMatch(membershipRoute, /inviteUserByEmail/);
});

test('sponsor portal scopes organisations, campaigns and metrics to the signed-in user', () => {
  assert.match(sponsorPortalPage, /supabase\.auth\.getUser/);
  assert.match(sponsorPortalPage, /sponsor_memberships/);
  assert.match(sponsorPortalPage, /\.eq\('user_id', user\.id\)/);
  assert.match(sponsorPortalPage, /get_sponsor_campaign_analytics/);
  assert.match(sponsorPortalPage, /SponsorPortal/);
  assert.match(sponsorPortal, /Aggregate reporting/);
  assert.match(sponsorPortal, /Individual user identities are never shared/);
  assert.match(sponsorPortal, /role === 'owner' \|\| selectedOrganization\.role === 'manager'/);
});

test('sponsor campaign APIs authenticate, rate-limit and delegate authorisation to database RPCs', () => {
  for (const route of [campaignCreateRoute, campaignUpdateRoute]) {
    assert.match(route, /getAuthenticatedUserFromRequest/);
    assert.match(route, /isSameOriginOrNativeRequest/);
    assert.match(route, /checkApiRateLimit/);
    assert.match(route, /serviceClient|adminClient/);
  }
  assert.match(campaignCreateRoute, /sponsor_create_campaign/);
  assert.match(campaignUpdateRoute, /sponsor_update_campaign/);
});
