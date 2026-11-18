import type { ReactNode } from 'react';

export type FeedEntryLike = {
  type: string;
  topicId: string;
};

export type FeedEntryDirection = 'next' | 'previous';

export type FeedEntryRegistration<TContext = unknown> = {
  type: string;
  matches: (entry: FeedEntryLike) => boolean;
  render: (entry: FeedEntryLike, context: TContext) => ReactNode;
  onNext: (entry: FeedEntryLike, context: TContext) => void | Promise<void>;
  onPrevious: (entry: FeedEntryLike, context: TContext) => void | Promise<void>;
};

export function registerFeedEntry<TEntry extends FeedEntryLike, TContext = unknown>(
  type: TEntry['type'],
  definition: {
    render: (entry: TEntry, context: TContext) => ReactNode;
    onNext: (entry: TEntry, context: TContext) => void | Promise<void>;
    onPrevious: (entry: TEntry, context: TContext) => void | Promise<void>;
  }
): FeedEntryRegistration<TContext> {
  const matches = (entry: FeedEntryLike): entry is TEntry => entry.type === type;
  return {
    type,
    matches,
    render: (entry, context) => matches(entry) ? definition.render(entry, context) : null,
    onNext: (entry, context) => matches(entry) ? definition.onNext(entry, context) : undefined,
    onPrevious: (entry, context) => matches(entry) ? definition.onPrevious(entry, context) : undefined,
  };
}

export function findFeedEntryRegistration<TContext>(
  entry: FeedEntryLike,
  registrations: readonly FeedEntryRegistration<TContext>[]
): FeedEntryRegistration<TContext> | null {
  return registrations.find((registration) => registration.matches(entry)) ?? null;
}

export function renderRegisteredFeedEntry<TContext>(
  entry: FeedEntryLike,
  registrations: readonly FeedEntryRegistration<TContext>[],
  context: TContext
): ReactNode {
  return findFeedEntryRegistration(entry, registrations)?.render(entry, context) ?? null;
}

export function invokeRegisteredFeedEntryAction<TContext>(
  entry: FeedEntryLike,
  direction: FeedEntryDirection,
  registrations: readonly FeedEntryRegistration<TContext>[],
  context: TContext
): void | Promise<void> {
  const registration = findFeedEntryRegistration(entry, registrations);
  if (!registration) return;
  return direction === 'next'
    ? registration.onNext(entry, context)
    : registration.onPrevious(entry, context);
}
