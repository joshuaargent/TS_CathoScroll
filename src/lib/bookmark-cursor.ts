import { Buffer } from 'node:buffer';

export interface BookmarkCursor {
  createdAt: string;
  topicId: string;
}

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const topicIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidCursor(cursor: BookmarkCursor): boolean {
  return timestampPattern.test(cursor.createdAt) && !Number.isNaN(Date.parse(cursor.createdAt)) && topicIdPattern.test(cursor.topicId);
}

export function encodeBookmarkCursor(bookmark: { created_at: string; topic_id: string }): string {
  const cursor = { createdAt: bookmark.created_at, topicId: bookmark.topic_id };
  if (!isValidCursor(cursor)) throw new Error('Cannot encode an invalid bookmark cursor.');
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeBookmarkCursor(value?: string): BookmarkCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid bookmark cursor.');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 2 ||
      !('createdAt' in parsed) || !('topicId' in parsed) || typeof parsed.createdAt !== 'string' || typeof parsed.topicId !== 'string') {
      throw new Error('Invalid bookmark cursor.');
    }
    const cursor = { createdAt: parsed.createdAt, topicId: parsed.topicId };
    if (!isValidCursor(cursor)) throw new Error('Invalid bookmark cursor.');
    return cursor;
  } catch {
    throw new Error('Invalid bookmark cursor.');
  }
}