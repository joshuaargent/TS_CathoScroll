import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [sponsorManager, campaignManager, sponsorPortal, feedCore, topComments, sponsorCard] = await Promise.all([
  readFile(new URL('../src/components/admin/SponsorManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/SponsorCampaignManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/sponsor/SponsorPortal.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopicFeedCore.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/TopCommentFeedCard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/topic/SponsorFeedCard.tsx', import.meta.url), 'utf8'),
]);

test('admin can create sponsors, assign existing accounts, manage membership and pause an organisation', () => {
  assert.match(sponsorManager, /Create sponsor/);
  assert.match(sponsorManager, /Existing account email/);
  assert.match(sponsorManager, /Grant access/);
  assert.match(sponsorManager, /Owner/);
  assert.match(sponsorManager, /Manager/);
  assert.match(sponsorManager, /Analyst/);
  assert.match(sponsorManager, /Suspend/);
  assert.match(sponsorManager, /Reactivate/);
  assert.match(sponsorManager, /Revoke/);
  assert.match(sponsorManager, /Update status/);
  assert.match(sponsorManager, /value="paused"/);
  assert.doesNotMatch(sponsorManager, /Mark received/);
});

test('campaigns require administrator approval and an eligible sponsor/payment state', () => {
  assert.match(campaignManager, /pending_approval/);
  assert.match(campaignManager, /Approval is blocked/);
  assert.match(campaignManager, /No campaigns created/);
  assert.match(campaignManager, /no empty advertising slot/);
});

test('sponsor users can submit campaigns and view only their own aggregate financial records', () => {
  assert.match(sponsorPortal, /Submit campaign for review/);
  assert.match(sponsorPortal, /Edit submission/);
  assert.match(sponsorPortal, /Invoices and payments/);
  assert.match(sponsorPortal, /No sponsor organisation linked/);
  assert.match(sponsorPortal, /Individual user identities are never shared/);
  assert.match(sponsorPortal, /role === 'owner'/);
  assert.match(sponsorPortal, /role === 'manager'/);
});

test('feed gracefully omits missing comment and sponsor inventory without blank interstitials', () => {
  assert.match(feedCore, /setShowTopCommentCard\(true\)/);
  assert.match(feedCore, /result\.campaigns\.length > 0/);
  assert.match(feedCore, /unseenTopComments\.length > 0/);
  assert.match(sponsorCard, /Sponsored/);
  assert.match(sponsorCard, /target="_blank"/);
  assert.match(sponsorManager, /No sponsors recorded/);
});
