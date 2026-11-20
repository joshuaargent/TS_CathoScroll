import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('web and native sign-in still support optional user-enrolled TOTP factors', async () => {
  const form = await read('src/components/auth/SigninForm.tsx');
  assert.match(form, /getAuthenticatorAssuranceLevel/);
  assert.match(form, /nextLevel === 'aal2'/);
  assert.match(form, /listFactors/);
  assert.match(form, /factorData\.totp\.find\(\(item\) => item\.status === 'verified'\)/);
  assert.match(form, /supabase\.auth\.mfa\.challenge/);
  assert.match(form, /supabase\.auth\.mfa\.verify/);
  assert.match(form, /assurance\.currentLevel !== 'aal2'/);
  const nativeSignIn = await read('native/signin.tsx');
  assert.match(nativeSignIn, /clientFactory=\{createClient\}/);
});

test('web and native account security offer authenticator enrolment without custom enforcement', async () => {
  const web = await read('src/app/account/security/page.tsx');
  const nativeAccount = await read('native/account.tsx');
  const nativeSecurity = await read('native/account-mfa-security.tsx');
  const main = await read('native/main.tsx');
  for (const source of [web, nativeSecurity]) {
    assert.match(source, /auth\.mfa\.enroll/);
    assert.match(source, /auth\.mfa\.challenge/);
    assert.match(source, /auth\.mfa\.verify/);
    assert.doesNotMatch(source, /administrator MFA enforcement|mfa-enforcement/);
  }
  assert.match(nativeAccount, /NativeAccountMfaSecurity/);
  assert.doesNotMatch(main, /NativeMfaGate|mfa-enforcement/);
});

test('administrator authorisation is role-based and does not depend on paid MFA enforcement', async () => {
  const helper = await read('src/lib/supabase/admin.ts');
  const bootstrap = await read('docs/cathoscroll-database-bootstrap.sql');
  assert.match(helper, /from\('admin_users'\)/);
  assert.doesNotMatch(helper, /admin_mfa_enforcement_enabled|admin_user_has_verified_totp|adminMfaSatisfied/);
  assert.doesNotMatch(bootstrap, /security_controls|admin_mfa_enforcement_enabled|enable_admin_mfa_enforcement|admin_user_has_verified_totp|admin_mfa_enforced/);
  assert.doesNotMatch(bootstrap, /Target account must verify MFA before receiving administrator access/);
});
