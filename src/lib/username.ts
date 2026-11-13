const reservedUsernames = new Set([
  'admin',
  'administrator',
  'support',
  'help',
  'owner',
  'root',
  'system',
  'staff',
  'moderator',
  'cathoscroll',
]);

export function usernameError(username: string): string | null {
  if (reservedUsernames.has(username)) return 'That username is unavailable.';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return 'Username must be 3-20 characters and contain only letters, numbers, and underscores.';
  }
  return null;
}
