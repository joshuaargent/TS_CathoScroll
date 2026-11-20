import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('web and native sign-in use the standard password flow without MFA challenges', async () => {
  const form = await read('src/components/auth/SigninForm.tsx');
  assert.match(form, /signInWithPassword/);
  assert.match(form, /onSignedIn\(\)/);
  assert.doesNotMatch(form, /\.auth\.mfa|Authenticator code|needsMfa|aal2|factorId|challengeId/);
  const nativeSignIn = await read('native/signin.tsx');
  assert.match(nativeSignIn, /clientFactory=\{createClient\}/);
  assert.doesNotMatch(nativeSignIn, /\.auth\.mfa|Authenticator code|aal2/);
});

test('account surfaces do not expose authenticator enrolment or security settings', async () => {
  const webAccount = await read('src/app/account/page.tsx');
  const nativeAccount = await read('native/account.tsx');
  const securityPage = await read('src/app/account/security/page.tsx').catch(() => '');
  assert.doesNotMatch(webAccount, /authenticator|account\/security/i);
  assert.doesNotMatch(nativeAccount, /NativeAccountMfaSecurity|account-mfa-security/);
  assert.equal(securityPage, '');
});

test('administrator authorisation is role-based with no MFA requirement', async () => {
  const helper = await read('src/lib/supabase/admin.ts');
  const bootstrap = await read('docs/cathoscroll-database-bootstrap.sql');
  const docs = await read('docs/security-hardening.md');
  assert.match(helper, /from\('admin_users'\)/);
  assert.doesNotMatch(helper, /mfaRequired|\.auth\.mfa|aal2|TOTP/);
  assert.doesNotMatch(bootstrap, /security_controls|admin_mfa|enable_admin_mfa|verified_totp|aal2|TOTP/);
  assert.match(docs, /does not implement multi-factor authentication/i);
});
