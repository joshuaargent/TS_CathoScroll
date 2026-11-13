import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityBootstrapTransport,
  ActivityHead,
  ActivitySnapshotPage,
} from './activity-bootstrap';
import type {
  OfflineActivityKind,
  PendingActivity,
  ServerActivity,
  SnapshotActivity,
} from './activity-store';
import type { ActivityPage, ActivityReceipt } from './activity-sync';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid offline activity server response.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error('Invalid offline activity server response.');
  }
  return value;
}

function kind(value: unknown): OfflineActivityKind {
  if (value !== 'bookmark' && value !== 'like' && value !== 'progress') {
    throw new Error('Invalid offline activity kind from server.');
  }
  return value;
}

function revision(value: unknown): string {
  const result = text(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) {
    throw new Error('Invalid offline activity revision from server.');
  }
  return result;
}

function identity(value: unknown, userId: string): string {
  const result = text(value);
  if (result !== userId) throw new Error('Offline activity server account does not match.');
  return result;
}

function snapshotItem(value: unknown): SnapshotActivity {
  const item = record(value);
  return { topicId: text(item.topicId), kind: kind(item.kind) };
}

function change(value: unknown): ServerActivity {
  const item = record(value);
  if (typeof item.value !== 'boolean')
    throw new Error('Invalid offline activity value from server.');
  const result = {
    topicId: text(item.topicId),
    kind: kind(item.kind),
    value: item.value,
    revision: revision(item.revision),
  };
  if (result.revision === '0') throw new Error('Invalid offline activity revision from server.');
  return result;
}

export class SupabaseActivityTransport implements ActivityBootstrapTransport {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc(
    name: string,
    args: Record<string, string | boolean | number | null>,
    signal?: AbortSignal
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const request = this.client.rpc(name, args);
    const result = await (signal ? request.abortSignal(signal) : request);
    signal?.throwIfAborted();
    if (result.error) {
      throw new Error(`Offline activity request failed: ${result.error.message}`, {
        cause: result.error,
      });
    }
    return result.data;
  }

  async head(userId: string, signal?: AbortSignal): Promise<ActivityHead> {
    const data = record(await this.rpc('offline_activity_head', { p_user: userId }, signal));
    return { userId: identity(data.userId, userId), revision: revision(data.revision) };
  }

  async snapshot(
    userId: string,
    cursor: string | null,
    signal?: AbortSignal
  ): Promise<ActivitySnapshotPage> {
    const data = record(
      await this.rpc('offline_activity_snapshot', { p_user: userId, p_cursor: cursor }, signal)
    );
    if (!Array.isArray(data.items) || data.items.length > 500) {
      throw new Error('Invalid offline activity snapshot from server.');
    }
    const nextCursor = data.nextCursor === null ? null : text(data.nextCursor);
    if (nextCursor !== null && nextCursor.length > 4096) {
      throw new Error('Invalid offline activity snapshot cursor from server.');
    }
    return {
      userId: identity(data.userId, userId),
      items: data.items.map(snapshotItem),
      nextCursor,
    };
  }

  async changes(userId: string, cursor: string, signal?: AbortSignal): Promise<ActivityPage> {
    const data = record(
      await this.rpc(
        'offline_activity_changes',
        { p_user: userId, p_after: revision(cursor) },
        signal
      )
    );
    if (
      !Array.isArray(data.changes) ||
      data.changes.length > 500 ||
      typeof data.hasMore !== 'boolean'
    ) {
      throw new Error('Invalid offline activity changes from server.');
    }
    return {
      userId: identity(data.userId, userId),
      changes: data.changes.map(change),
      hasMore: data.hasMore,
    };
  }

  async send(operation: PendingActivity, signal?: AbortSignal): Promise<ActivityReceipt> {
    const data = record(
      await this.rpc(
        'offline_apply_activity',
        {
          p_user: operation.userId,
          p_operation: operation.operationId,
          p_kind: operation.kind,
          p_topic: operation.topicId,
          p_value: operation.value,
        },
        signal
      )
    );
    if (typeof data.value !== 'boolean' || data.value !== operation.value) {
      throw new Error('Offline activity server receipt value does not match.');
    }
    const operationId = text(data.operationId);
    if (operationId !== operation.operationId) {
      throw new Error('Offline activity server operation does not match.');
    }
    const receiptRevision = revision(data.revision);
    if (receiptRevision === '0') throw new Error('Invalid offline activity receipt revision.');
    return {
      userId: identity(data.userId, operation.userId),
      operationId,
      revision: receiptRevision,
      value: data.value,
    };
  }
}
