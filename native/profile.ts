import type { SupabaseClient } from '@supabase/supabase-js';
import { usernameError } from '@/lib/username';
import type { CachedProfile } from './profile-cache';

async function authenticatedUser(client: SupabaseClient, userId: string) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user || data.user.id !== userId) throw new Error('Account does not match.');
  return data.user;
}

async function profileExists(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function getNativeProfileStatus(
  client: SupabaseClient,
  userId: string
): Promise<{ exists: boolean; suggestedUsername: string }> {
  const user = await authenticatedUser(client, userId);
  const suggested = user.user_metadata?.username;
  return {
    exists: await profileExists(client, userId),
    suggestedUsername: typeof suggested === 'string' ? suggested.trim().toLowerCase() : '',
  };
}

export async function createNativeProfile(
  client: SupabaseClient,
  userId: string,
  username: string
): Promise<'created' | 'exists' | 'taken'> {
  const cleaned = username.trim().toLowerCase();
  const validation = usernameError(cleaned);
  if (validation) throw new Error(validation);
  await authenticatedUser(client, userId);
  if (await profileExists(client, userId)) return 'exists';
  const { error } = await client.from('profiles').insert({
    id: userId,
    username: cleaned,
    display_name: cleaned,
  });
  if (!error) return 'created';
  if (error.code === '23505') {
    return (await profileExists(client, userId)) ? 'exists' : 'taken';
  }
  throw error;
}

export async function readNativeProfile(
  client: SupabaseClient,
  userId: string
): Promise<CachedProfile> {
  await authenticatedUser(client, userId);
  const { data, error } = await client
    .from('profiles')
    .select('username, display_name, bio')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    typeof data.username !== 'string' ||
    typeof data.display_name !== 'string' ||
    (data.bio !== null && typeof data.bio !== 'string')
  ) {
    throw new Error('Invalid account profile.');
  }
  return { username: data.username, displayName: data.display_name, bio: data.bio ?? '' };
}

export async function updateNativeProfile(
  client: SupabaseClient,
  userId: string,
  profile: CachedProfile
): Promise<{ status: 'saved'; profile: CachedProfile } | { status: 'taken' }> {
  const username = profile.username.trim().toLowerCase();
  const validation = usernameError(username);
  if (validation) throw new Error(validation);
  if (profile.displayName.trim().length < 2)
    throw new Error('Display name must be at least 2 characters.');
  if (profile.bio.length > 250) throw new Error('Bio cannot exceed 250 characters.');
  const updated = { username, displayName: profile.displayName.trim(), bio: profile.bio.trim() };
  await authenticatedUser(client, userId);
  const { data, error } = await client
    .from('profiles')
    .update({ username, display_name: updated.displayName, bio: updated.bio || null })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return { status: 'taken' };
    throw error;
  }
  if (!data || data.id !== userId) throw new Error('Account profile was not updated.');
  return { status: 'saved', profile: updated };
}
