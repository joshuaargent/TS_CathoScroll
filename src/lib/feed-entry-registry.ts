import type { ReactNode } from 'react';

import type { FeedEntry } from './feed-entry-map';

export type FeedEntryDirection = 'next' | 'previous';

export type FeedEntryRegistrationContext = {
  navigate: (direction: FeedEntryDirection) => void | Promise<void>;
};

export type FeedEntryRegistration<TContext = FeedEntryRegistrationContext> = {
  type: FeedEntry['type'];
  matches: (entry: FeedEntry) => boolean;
  render: (entry: FeedEntry, context: TContext) => ReactNode;
  onNext: (entry: FeedEntry, context: TContext) => void | Promise<void>;
  onPrevious: (entry: FeedEntry, context: TContext) => void | Promise<void>;
};

type FeedEntryOfType<TType extends FeedEntry['type']> = Extract<FeedEntry, { type: TType }>;

export function registerFeedEntry<TType extends FeedEntry['type'], TContext = FeedEntryRegistrationContext>(
  type: TType,
  definition: {
    render: (entry: FeedEntryOfType<TType>, context: TContext) => ReactNode;
    onNext: (entry: FeedEntryOfType<TType>, context: TContext) => void | Promise<void>;
    onPrevious: (entry: FeedEntryOfType<TType>, context: TContext) => void | Promise<void>;
  }
): FeedEntryRegistration<TContext> {
  const matches = (entry: FeedEntry): entry is FeedEntryOfType<TType> => entry.type === type;
  return {
    type,
    matches,
    render: (entry, context) => matches(entry) ? definition.render(entry, context) : null,
    onNext: (entry, context) => matches(entry) ? definition.onNext(entry, context) : undefined,
    onPrevious: (entry, context) => matches(entry) ? definition.onPrevious(entry, context) : undefined,
  };
}

export function findFeedEntryRegistration<TContext>(
  entry: FeedEntry,
  registrations: readonly FeedEntryRegistration<TContext>[]
): FeedEntryRegistration<TContext> | null {
  return registrations.find((registration) => registration.matches(entry)) ?? null;
}

export function renderRegisteredFeedEntry<TContext>(
  entry: FeedEntry,
  registrations: readonly FeedEntryRegistration<TContext>[],
  context: TContext
): ReactNode {
  return findFeedEntryRegistration(entry, registrations)?.render(entry, context) ?? null;
}

export function invokeRegisteredFeedEntryAction<TContext>(
  entry: FeedEntry,
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
