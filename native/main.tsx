import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommentSection } from '@/components/comments/CommentSection';
import { TopicFeedCore } from '@/components/topic/TopicFeedCore';
import { TopicSwipeViewer } from '@/components/topic/TopicSwipeViewer';
import { TopicArticle, TopicArticleHeader } from '@/components/topic/TopicArticle';
import { CategoriesPage, CategoryPage, SearchPage } from './catalogue-pages';
import { NativeNavbar } from './navbar';
import { NativeAccount } from './account';
import { NativeBookmarks } from './bookmarks';
import { NativeTopicActions } from './topic-actions';
import { NativeSignup } from './signup';
import { LearnContent } from '@/components/learn/LearnContent';
import { NativeActivity, type NativeActivityStatus } from './activity';
import { openPrivateActivity } from './private-activity';
import { NativeNotes } from './notes';
import { NativeNoteCache } from './note-cache';
import {
  cachedIdentityFromSession,
  identityAfterAuthEvent,
  type CachedIdentity,
} from './cached-identity';
import { initializeNativeAuth } from './supabase';
import { authStorageKey, secureAuthStorage } from './secure-auth-storage';
import { SignInPromptProvider, useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { OfflineCatalogue, type CatalogueCursor } from '@/lib/offline/catalogue';
import { OfflineCommentCache } from '@/lib/offline/comment-cache';
import { OfflineTopicCountCache, type CachedTopicCounts } from '@/lib/offline/topic-count-cache';
import { loadTopicActivity } from '@/lib/topic-activity';
import { createClient } from '@/lib/supabase/client';
import { siteConfig } from '@/lib/constants';
import type { RecommendationCursor } from '@/lib/recommendations';
import { openNativeDatabases } from '@/lib/offline/native-database';
import { SupabaseActivityTransport } from '@/lib/offline/supabase-activity-transport';
import type { OfflineActivityKind, OfflineTopicActivity } from '@/lib/offline/activity-store';
import type { Topic } from '@/types';
import './style.css';

type CataloguePage = { topics: Topic[]; nextCursor: CatalogueCursor | null };
type Route =
  | { kind: 'feed'; pathname: string }
  | { kind: 'search'; pathname: string; query: string }
  | { kind: 'learn'; pathname: string }
  | { kind: 'categories'; pathname: string }
  | { kind: 'account'; pathname: string }
  | { kind: 'signup'; pathname: string }
  | { kind: 'bookmarks'; pathname: string }
  | { kind: 'category'; pathname: string; slug: string }
  | { kind: 'topic'; pathname: string; slug: string; comments: boolean };

function parseRoute(href: string): Route | null {
  try {
    const url = new URL(href, 'https://native.cathoscroll.invalid');
    if (url.origin !== 'https://native.cathoscroll.invalid') return null;
    const pathname = url.pathname;
    if (pathname === '/') return { kind: 'feed', pathname };
    if (pathname === '/learn') return { kind: 'learn', pathname };
    if (pathname === '/search') {
      return { kind: 'search', pathname, query: url.searchParams.get('q') ?? '' };
    }
    if (pathname === '/categories') return { kind: 'categories', pathname };
    if (pathname === '/signin' || pathname === '/account') return { kind: 'account', pathname };
    if (pathname === '/signup') return { kind: 'signup', pathname };
    if (pathname === '/bookmarks') return { kind: 'bookmarks', pathname };
    const match = /^\/(topic|categories)\/([^/]+)$/.exec(pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[2]);
    if (!slug || slug.trim() !== slug || slug.includes('/')) return null;
    return match[1] === 'topic'
      ? { kind: 'topic', pathname, slug, comments: url.hash === '#comments' }
      : { kind: 'category', pathname, slug };
  } catch {
    return null;
  }
}

function currentHref() {
  return window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/';
}

function openRoute(href: string) {
  window.dispatchEvent(new CustomEvent('cathoscroll:navigate', { detail: href }));
}

const TopicNavigation = createContext<{
  feedActive: boolean;
  open: (topic: Topic) => void;
  counts: OfflineTopicCountCache | null;
  userId: string | null;
  activity: NativeActivity | null;
  activityStatus: NativeActivityStatus | null;
  activityVersion: number;
  retryActivitySetup: () => void;
} | null>(null);

function NativeViewer(props: {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
}) {
  const [message, setMessage] = useState('');
  const [shareMessage, setShareMessage] = useState<{ topicId: string; text: string } | null>(null);
  const [countError, setCountError] = useState('');
  const [counts, setCounts] = useState<{
    topicId: string;
    value: CachedTopicCounts;
    fresh: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [savedActivity, setSavedActivity] = useState<{
    userId: string;
    topicId: string;
    value: OfflineTopicActivity;
  } | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [pendingActions, setPendingActions] = useState(() => new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const requestSignIn = useSignInPrompt();
  const navigation = useContext(TopicNavigation);
  if (!navigation?.counts) throw new Error('Native topic navigation is unavailable.');
  const topicId = String(props.topics[props.topicIndex].id);
  const countCache = navigation.counts;
  const userId = navigation.userId;
  const accountActivity = navigation.activity;
  const accountReady =
    Boolean(userId) &&
    accountActivity?.userId === userId &&
    navigation.activityStatus?.userId === userId &&
    navigation.activityStatus.ready;

  useEffect(() => {
    let active = true;
    if (!userId || !accountActivity || !accountReady) return;
    accountActivity.store.topicActivity(userId, topicId).then(
      (value) => {
        if (active) {
          setSavedActivity({ userId, topicId, value });
          setActivityError(false);
        }
      },
      (cause: unknown) => {
        console.error('Unable to load saved account activity:', cause);
        if (active) {
          setSavedActivity(null);
          setActivityError(true);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [accountActivity, accountReady, userId, topicId, navigation.activityVersion, refresh]);

  useEffect(() => {
    let active = true;
    async function load() {
      setCountError('');
      try {
        const cached = await countCache.load(topicId);
        if (!active) return;
        setCounts(cached ? { topicId, value: cached, fresh: false } : null);
      } catch (error) {
        console.error('Unable to load cached topic counts:', error);
        if (active) setCountError('Saved topic counts could not be loaded.');
      }

      if (!navigator.onLine || !active) return;
      try {
        const result = await loadTopicActivity(createClient(), topicId, null);
        if (!active) return;
        setCounts({
          topicId,
          value: {
            likes: result.likes,
            comments: result.comments,
            savedAt: new Date().toISOString(),
          },
          fresh: true,
        });
        setCountError('');
        try {
          await countCache.save(topicId, result.likes, result.comments);
        } catch (error) {
          console.error('Unable to save topic counts:', error);
          if (active) setCountError('Topic counts could not be saved for offline viewing.');
        }
      } catch (error) {
        console.error('Unable to refresh topic counts:', error);
        if (active) setCountError('Topic counts could not be refreshed.');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [countCache, topicId, refresh, navigation.activityVersion]);

  useEffect(() => {
    const update = () => setRefresh((version) => version + 1);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const currentCounts = counts?.topicId === topicId ? counts : null;
  const currentSaved =
    accountReady && savedActivity?.userId === userId && savedActivity.topicId === topicId
      ? savedActivity.value
      : null;

  async function changeActivity(kind: OfflineActivityKind, value: boolean, target: string) {
    if (!userId) {
      if (kind !== 'progress') requestSignIn(kind === 'like' ? 'like topics' : 'save bookmarks');
      return;
    }
    if (
      !accountActivity ||
      target !== topicId ||
      (kind !== 'progress' && (!accountReady || !currentSaved))
    ) {
      setMessage('Connect to set up your saved account activity on this device.');
      return;
    }
    const key = `${kind}:${target}`;
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingActions(new Set(pendingRef.current));
    setMessage('');
    try {
      await accountActivity.set(target, kind, value);
      setSavedActivity((previous) => {
        if (!previous || previous.userId !== userId || previous.topicId !== target) return previous;
        const key = kind === 'like' ? 'liked' : kind === 'bookmark' ? 'bookmarked' : 'completed';
        return { ...previous, value: { ...previous.value, [key]: value } };
      });
    } catch (cause) {
      console.error(`Unable to save ${kind}:`, cause);
      setMessage('Unable to save your change on this device. Please try again.');
    } finally {
      pendingRef.current.delete(key);
      setPendingActions(new Set(pendingRef.current));
    }
  }

  async function shareTopic() {
    setShareMessage(null);
    setMessage('');
    try {
      const topic = props.topics[props.topicIndex];
      const url = new URL(`/topic/${encodeURIComponent(topic.slug)}`, siteConfig.url).toString();
      if (navigator.share) {
        await navigator.share({ title: topic.question, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareMessage({ topicId, text: 'Topic link copied.' });
      } else {
        setMessage('Sharing is not available on this device.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Unable to share topic:', error);
      setMessage('Unable to share this topic. Please try again.');
    }
  }

  return (
    <div className="flex h-full flex-col">
      {shareMessage?.topicId === topicId && (
        <p role="status" className="text-text-secondary px-6 text-sm">
          {shareMessage.text}
        </p>
      )}
      {(!navigator.onLine || (currentCounts && !currentCounts.fresh)) && (
        <p role="status" className="text-text-secondary px-6 text-xs">
          {navigator.onLine
            ? countError
              ? 'Counts could not be refreshed and may not be accurate.'
              : 'Showing saved counts while they update.'
            : "You're offline. Like and comment counts may not be accurate until you reconnect."}
        </p>
      )}
      {userId && !accountReady && (
        <p role="status" className="text-text-secondary px-6 text-xs">
          {navigation.activityStatus?.userId === userId && navigation.activityStatus.error
            ? navigation.activityStatus.error
            : 'Connect to set up your saved account activity on this device.'}
          {!accountActivity &&
            navigation.activityStatus?.userId === userId &&
            navigation.activityStatus.error && (
              <>
                {' '}
                <button type="button" className="underline" onClick={navigation.retryActivitySetup}>
                  Retry
                </button>
              </>
            )}
        </p>
      )}
      {accountReady && navigation.activityStatus?.error && (
        <p role="status" className="text-text-secondary px-6 text-xs">
          {navigation.activityStatus.error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <TopicSwipeViewer
          {...props}
          active={navigation.feedActive}
          userId={userId}
          currentActivity={
            !userId || currentSaved
              ? {
                  topicId,
                  userId,
                  likes: currentCounts?.value.likes ?? null,
                  comments: currentCounts?.value.comments ?? null,
                  liked: currentSaved?.liked ?? false,
                  bookmarked: currentSaved?.bookmarked ?? false,
                  completed: currentSaved?.completed ?? false,
                }
              : null
          }
          currentActivityError={Boolean(userId && accountReady && activityError)}
          actionError={[message, countError].filter(Boolean).join(' ')}
          pendingActions={pendingActions}
          retryActivity={() => {
            setMessage('');
            setRefresh((version) => version + 1);
            accountActivity?.requestSync();
          }}
          onLike={() => void changeActivity('like', !currentSaved?.liked, topicId)}
          onDoubleTapLike={() => void changeActivity('like', true, topicId)}
          onBookmark={() => void changeActivity('bookmark', !currentSaved?.bookmarked, topicId)}
          onComments={() => navigation.open(props.topics[props.topicIndex])}
          onShare={() => void shareTopic()}
          onComplete={(target) => {
            if (userId && !currentSaved?.completed) {
              void changeActivity('progress', true, target);
            }
          }}
        />
      </div>
    </div>
  );
}

function NativeTopicPage({
  catalogue,
  cache,
  noteCache,
  userId,
  activity,
  activityStatus,
  activityVersion,
  slug,
  showComments,
}: {
  catalogue: OfflineCatalogue;
  cache: OfflineCommentCache;
  noteCache: NativeNoteCache;
  userId: string | null;
  activity: NativeActivity | null;
  activityStatus: NativeActivityStatus | null;
  activityVersion: number;
  slug: string;
  showComments: boolean;
}) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    catalogue.topic(slug).then(
      (result) => {
        if (!active) return;
        setTopic(result);
        setLoading(false);
      },
      (cause: unknown) => {
        console.error('Unable to load offline topic:', cause);
        if (active) {
          setError('Unable to load this topic. Please try again.');
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [catalogue, slug, attempt]);

  useEffect(() => {
    if (topic && showComments) document.getElementById('comments')?.scrollIntoView();
  }, [topic, showComments]);

  return (
    <div className="container py-12">
      <button type="button" className="text-accent" onClick={() => openRoute('/')}>
        ← Explore Feed
      </button>
      {loading && (
        <p role="status" className="mt-8">
          Loading topic…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-8">
          {error}{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => {
              setError('');
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!loading && !error && !topic && <p className="mt-8">Topic not found.</p>}
      {topic && (
        <>
          <TopicArticleHeader topic={topic} />
          <NativeTopicActions
            topic={topic}
            userId={userId}
            activity={activity}
            status={activityStatus}
            version={activityVersion}
          />
          <TopicArticle topic={topic} />
          <NativeNotes userId={userId} topicId={String(topic.id)} cache={noteCache} />
          <CommentSection topicId={String(topic.id)} cache={cache} serverActionsAvailable={false} />
        </>
      )}
    </div>
  );
}

function App() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogue | null>(null);
  const [firstPage, setFirstPage] = useState<CataloguePage | null>(null);
  const [commentCache, setCommentCache] = useState<OfflineCommentCache | null>(null);
  const [countCache, setCountCache] = useState<OfflineTopicCountCache | null>(null);
  const [noteCache, setNoteCache] = useState<NativeNoteCache | null>(null);
  const [href, setHref] = useState(currentHref);
  const route = parseRoute(href);
  const [error, setError] = useState('');
  const [navigationMessage, setNavigationMessage] = useState('');
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [checkingAccount, setCheckingAccount] = useState(true);
  const [user, setUser] = useState<CachedIdentity | null>(null);
  const [activity, setActivity] = useState<NativeActivity | null>(null);
  const [activityStatus, setActivityStatus] = useState<NativeActivityStatus | null>(null);
  const [activityVersion, setActivityVersion] = useState(0);
  const [activityAttempt, setActivityAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let removeConnectivityListeners: (() => void) | undefined;
    async function start() {
      try {
        try {
          await initializeNativeAuth();
          let cachedIdentity = cachedIdentityFromSession(
            await secureAuthStorage.getItem(authStorageKey)
          );
          if (active && cachedIdentity) {
            setUser(cachedIdentity);
            setCheckingAccount(false);
          }
          const supabase = createClient();
          const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (active) {
              cachedIdentity = identityAfterAuthEvent(event, session, cachedIdentity);
              setUser(cachedIdentity);
              setCheckingAccount(false);
            }
          });
          unsubscribe = () => data.subscription.unsubscribe();
          if (!active) {
            unsubscribe();
            return;
          }
          setAuthStatus('ready');
          const verifySession = () => {
            void supabase.auth
              .getSession()
              .then(({ error: sessionError }) => {
                if (sessionError) throw sessionError;
                if (active) setAuthStatus('ready');
              })
              .catch((cause: unknown) => {
                console.error('Unable to restore the native account:', cause);
                if (active) {
                  if (cachedIdentity) {
                    setUser(cachedIdentity);
                    setAuthStatus('ready');
                  } else {
                    setAuthStatus('unavailable');
                  }
                  setCheckingAccount(false);
                }
              });
          };
          const restoreOfflineIdentity = () => {
            if (active && cachedIdentity) {
              setUser(cachedIdentity);
              setAuthStatus('ready');
              setCheckingAccount(false);
            }
          };
          window.addEventListener('online', verifySession);
          window.addEventListener('offline', restoreOfflineIdentity);
          removeConnectivityListeners = () => {
            window.removeEventListener('online', verifySession);
            window.removeEventListener('offline', restoreOfflineIdentity);
          };
          verifySession();
        } catch (cause) {
          console.error('Unable to initialize secure native sign-in:', cause);
          if (active) {
            setAuthStatus('unavailable');
            setCheckingAccount(false);
          }
        }
        const databases = await openNativeDatabases();
        const localCatalogue = new OfflineCatalogue(databases.catalogue);
        const localComments = new OfflineCommentCache(databases.activity);
        const localCounts = new OfflineTopicCountCache(databases.activity);
        const localNotes = new NativeNoteCache(databases.activity, secureAuthStorage);
        await localComments.initialize();
        await localCounts.initialize();
        await localNotes.initialize();
        const page = await localCatalogue.topics();
        if (active) {
          setFirstPage(page);
          setCatalogue(localCatalogue);
          setCommentCache(localComments);
          setCountCache(localCounts);
          setNoteCache(localNotes);
        }
      } catch (cause) {
        console.error('Unable to open the offline catalogue:', cause);
        if (active) setError('Unable to open the offline catalogue. Please restart the app.');
      }
    }
    void start();
    return () => {
      active = false;
      unsubscribe?.();
      removeConnectivityListeners?.();
    };
  }, []);

  useEffect(() => {
    if (!user?.id || authStatus !== 'ready') return;
    const userId = user.id;
    let active = true;
    let service: NativeActivity | undefined;
    const request = () => service?.requestSync();
    const resume = () => {
      if (document.visibilityState === 'visible') request();
    };
    async function startActivity() {
      try {
        const store = await openPrivateActivity();
        if (!active) return;
        service = new NativeActivity(
          userId,
          store,
          new SupabaseActivityTransport(createClient()),
          (status) => {
            if (active) {
              setActivityStatus(status);
              setActivityVersion((version) => version + 1);
            }
          },
          () => navigator.onLine
        );
        window.addEventListener('online', request);
        window.addEventListener('focus', request);
        document.addEventListener('visibilitychange', resume);
        await service.start();
        if (!active) return;
        setActivity(service);
      } catch (cause) {
        console.error('Unable to open saved account activity:', cause);
        if (active) {
          setActivityStatus({
            userId,
            ready: false,
            error: 'Saved account activity could not be opened on this device.',
          });
        }
      }
    }
    void startActivity();
    return () => {
      active = false;
      window.removeEventListener('online', request);
      window.removeEventListener('focus', request);
      document.removeEventListener('visibilitychange', resume);
      service?.dispose();
      setActivity((previous) => (previous === service ? null : previous));
    };
  }, [user?.id, authStatus, activityAttempt]);

  useEffect(() => {
    function navigate(event: Event) {
      const target =
        event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';
      if (!parseRoute(target)) {
        setNavigationMessage('This page is not available in the offline preview yet.');
        return;
      }
      window.history.pushState(null, '', `#${target}`);
      setHref(target);
      setNavigationMessage('');
      window.scrollTo(0, 0);
    }
    function restore() {
      setHref(currentHref());
      setNavigationMessage('');
      window.scrollTo(0, 0);
    }
    window.addEventListener('cathoscroll:navigate', navigate);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('cathoscroll:navigate', navigate);
      window.removeEventListener('popstate', restore);
    };
  }, []);

  const loadPage = useCallback(
    async (cursor: CatalogueCursor | RecommendationCursor) => {
      if (!catalogue) throw new Error('The offline catalogue is not ready.');
      if (!('orderIndex' in cursor)) throw new Error('Invalid offline topic cursor.');
      return catalogue.topics({ cursor });
    },
    [catalogue]
  );

  return (
    <ThemeProvider>
      <SignInPromptProvider>
        <TopicNavigation.Provider
          value={{
            feedActive: route?.kind === 'feed',
            open: (topic) => openRoute(`/topic/${encodeURIComponent(topic.slug)}#comments`),
            counts: countCache,
            userId: user?.id ?? null,
            activity: activity?.userId === user?.id ? activity : null,
            activityStatus,
            activityVersion,
            retryActivitySetup: () => setActivityAttempt((attempt) => attempt + 1),
          }}
        >
          <NativeNavbar pathname={route?.pathname ?? '/'} signedIn={Boolean(user)} />
          <main className="pt-16">
            {navigationMessage && (
              <div role="alert" className="bg-bg-card border-border mx-6 rounded-xl border p-4">
                {navigationMessage}{' '}
                <button
                  type="button"
                  className="text-accent underline"
                  onClick={() => setNavigationMessage('')}
                >
                  Dismiss
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="px-6">
                {error}
              </p>
            )}
            {!error && !firstPage && (
              <p role="status" className="px-6">
                Loading topics…
              </p>
            )}
            {firstPage && !firstPage.topics.length && <p className="px-6">No topics available.</p>}
            {firstPage && firstPage.topics.length > 0 && (
              <div className="h-[calc(100vh-4rem)] overflow-hidden" hidden={route?.kind !== 'feed'}>
                <TopicFeedCore
                  topics={firstPage.topics}
                  nextCursor={firstPage.nextCursor}
                  personalized={false}
                  loadPage={loadPage}
                  userId={user?.id ?? null}
                  viewer={NativeViewer}
                />
              </div>
            )}
            {catalogue && route?.kind === 'search' && (
              <SearchPage
                catalogue={catalogue}
                query={route.query}
                onQueryChange={(query) => {
                  const params = new URLSearchParams();
                  if (query) params.set('q', query);
                  const next = `/search${params.size ? `?${params}` : ''}`;
                  window.history.replaceState(null, '', `#${next}`);
                  setHref(next);
                }}
              />
            )}
            {catalogue && route?.kind === 'categories' && <CategoriesPage catalogue={catalogue} />}
            {route?.kind === 'learn' && <LearnContent />}
            {route?.kind === 'account' && (
              <NativeAccount
                user={user}
                checking={authStatus === 'loading' || checkingAccount}
                available={authStatus !== 'unavailable'}
                onSignedIn={() => openRoute('/account')}
                activity={activity?.userId === user?.id ? activity : null}
                activityStatus={activityStatus}
                onRetryActivity={() => setActivityAttempt((attempt) => attempt + 1)}
              />
            )}
            {route?.kind === 'signup' &&
              (authStatus === 'loading' || checkingAccount ? (
                <p className="container py-12">Loading account…</p>
              ) : authStatus === 'unavailable' ? (
                <p role="alert" className="container py-12">
                  Account creation is unavailable. Check your connection and try again.
                </p>
              ) : user ? (
                <div className="container py-12">
                  <p>You are already signed in.</p>
                  <button
                    type="button"
                    className="text-accent mt-4 underline"
                    onClick={() => openRoute('/account')}
                  >
                    Go to account
                  </button>
                </div>
              ) : (
                <NativeSignup onSignedUp={() => openRoute('/account')} />
              ))}
            {catalogue && route?.kind === 'bookmarks' && (
              <NativeBookmarks
                key={user?.id ?? 'signed-out'}
                catalogue={catalogue}
                userId={user?.id ?? null}
                activity={activity?.userId === user?.id ? activity : null}
                status={activityStatus}
                version={activityVersion}
              />
            )}
            {catalogue && route?.kind === 'category' && (
              <CategoryPage key={route.slug} catalogue={catalogue} slug={route.slug} />
            )}
            {catalogue && commentCache && noteCache && route?.kind === 'topic' && (
              <NativeTopicPage
                key={route.slug}
                catalogue={catalogue}
                cache={commentCache}
                noteCache={noteCache}
                userId={user?.id ?? null}
                activity={activity?.userId === user?.id ? activity : null}
                activityStatus={activityStatus}
                activityVersion={activityVersion}
                slug={route.slug}
                showComments={route.comments}
              />
            )}
            {!route && (
              <p role="alert" className="px-6">
                This page is not available in the offline preview yet.
              </p>
            )}
          </main>
        </TopicNavigation.Provider>
      </SignInPromptProvider>
    </ThemeProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<App />);
