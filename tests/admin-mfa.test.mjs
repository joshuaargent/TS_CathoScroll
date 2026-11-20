import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('web and native sign-in challenge enrolled TOTP factors before completing sign-in', async () => {
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

test('native Account exposes authenticator enrollment and owner enforcement controls', async () => {
  const account = await read('native/account.tsx');
  const security = await read('native/account-mfa-security.tsx');
  const main = await read('native/main.tsx');
  assert.match(account, /NativeAccountMfaSecurity/);
  assert.match(security, /auth\.mfa\.enroll/);
  assert.match(security, /auth\.mfa\.challenge/);
  assert.match(security, /auth\.mfa\.verify/);
  assert.match(security, /Enable administrator MFA enforcement/);
  assert.match(main, /pathname === '\/account\/security'/);
});

test('native enforcement requests use bearer authentication and server-verified TOTP claims', async () => {
  const route = await read('src/app/api/admin/security/mfa-enforcement/route.ts');
  const helper = await read('src/lib/supabase/admin.ts');
  assert.match(route, /isSameOriginOrNativeRequest\(request\)/);
  assert.match(route, /const \{ supabase, user, accessToken \} = await getAuthenticatedUserFromRequest\(request\)/);
  assert.match(route, /const verifiedToken = accessToken \?\? sessionData\.session\?\.access_token/);
  assert.match(route, /hasTotpAssuranceInAccessToken\(verifiedToken\)/);
  assert.match(helper, /claims\.aal === 'aal2'/);
  assert.match(helper, /entry\.method === 'totp'/);
  assert.match(helper, /admin_user_has_verified_totp/);
});

test('database enforcement is owner-only and refuses activation until every administrator has verified TOTP', async () => {
  const bootstrap = await read('docs/cathoscroll-database-bootstrap.sql');
  const route = await read('src/app/api/admin/security/mfa-enforcement/route.ts');
  assert.match(bootstrap, /IF p_actor_user_id IS NULL OR NOT EXISTS[\s\S]*admin_owners/);
  assert.match(bootstrap, /FROM public\.admin_users AS administrator[\s\S]*factor_type='totp'[\s\S]*status='verified'/);
  assert.match(bootstrap, /SET admin_mfa_enforced=true/);
  assert.match(route, /Only the CathoScroll owner can enable administrator MFA enforcement/);
});
