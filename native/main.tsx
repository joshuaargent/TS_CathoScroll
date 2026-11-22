import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CommentSection } from '@/components/comments/CommentSection';
import { TopicFeedCore } from '@/components/topic/TopicFeedCore';
import { TopicSwipeViewer } from '@/components/topic/TopicSwipeViewer';
import { TopicArticle, TopicArticleHeader } from '@/components/topic/TopicArticle';
import { CategoriesPage, CategoryPage, SearchPage } from './catalogue-pages';
import { NativeNavbar } from './navbar';
import { NativeAccount } from './account';
import { NativePublicProfile } from './public-profile';
import { NativeBookmarks } from './bookmarks';
import { NativeAdmin } from './admin';
import { NativeAppeal } from './appeal';
import { NativeNotifications, NativeNotificationsProvider } from './notifications';
import { OfflineIndicator, clearNativeStatusNotice, notifyNativeStatus } from './offline-indicator';
import { NativeTopicActions } from './topic-actions';
import { NativeSignup } from './signup';
import {
  NativeArticleSkeleton,
  NativeCategorySkeleton,
  NativeFeedSkeleton,
  NativeGridSkeleton,
} from './skeletons';
import { AccountPageSkeleton } from '@/components/account/AccountPageView';
import AboutPage from '@/app/about/page';
import FAQPage from '@/app/faq/page';
import ContactPage from '@/app/contact/page';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import CookiesPage from '@/app/cookies/page';
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
import { createClient, initializeNativeAuth } from './supabase';
import { authStorageKey, secureAuthStorage } from './secure-auth-storage';
import { SignInPromptProvider, useSignInPrompt } from '@/components/providers/SignInPromptProvider';
import { SponsorAnalyticsSync } from '@/components/providers/SponsorAnalyticsSync';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { AnalyticsConsentManager } from '@/components/privacy/AnalyticsConsentManager';
import { OfflineCatalogue, type CatalogueCursor } from '@/lib/offline/catalogue';
import { CatalogueRefresh } from '@/lib/offline/catalogue-refresh';
import { SupabaseCatalogueTransport } from '@/lib/offline/supabase-catalogue-transport';
import { OfflineCommentCache } from '@/lib/offline/comment-cache';
import { OfflineTopicCountCache, type CachedTopicCounts } from '@/lib/offline/topic-count-cache';
import { loadTopicActivity } from '@/lib/topic-activity';
import { siteConfig } from '@/lib/constants';
import { analyticsConsentChangeEvent, analyticsConsentSyncEvent, readAnalyticsConsent } from '@/lib/analytics-consent';
import { configureFeedAnalyticsOutbox, clearFeedAnalyticsOutbox } from '@/lib/feed-analytics-client';
import { configureFeedCardAnalyticsOutbox, clearFeedCardAnalyticsOutbox } from '@/lib/feed-card-analytics-client';
import { configureSponsorAnalyticsOutbox, clearSponsorAnalyticsOutbox } from '@/lib/sponsor-analytics-client';
import { NativeSignedInAnalyticsOutbox, resetLegacySignedInAnalyticsOutbox } from '@/lib/offline/signed-in-analytics-store';
import { OfflineRankedFeedCache, type CachedPersonalizationConsent } from '@/lib/offline/ranked-feed-cache';
import type { TopFeedComment } from '@/lib/feed-comments';
import type { RecommendationCursor } from '@/lib/recommendations';
import type { GeneralFeedCursor } from '@/lib/content';
import { openNativeDatabases, openPrivateActivityDatabase } from '@/lib/offline/native-database';
import { SupabaseActivityTransport } from '@/lib/offline/supabase-activity-transport';
import type { OfflineActivityKind, OfflineTopicActivity } from '@/lib/offline/activity-store';
import type { Topic } from '@/types';
import './style.css';

type CataloguePage = { topics: Topic[]; nextCursor: CatalogueCursor | GeneralFeedCursor | RecommendationCursor | null };

type NativeLiveTopicRow = {
  id: string;
  slug: string;
  question: string;
  answer: string;
  explanation: string;
  catechism_paragraphs: string[] | null;
  catechism_text: string;
  scripture_reference: string;
  scripture_text: string;
  category: { name: string } | Array<{ name: string }> | null;
};


async function loadNativeLiveTopicBySlug(slug: string): Promise<Topic | null> {
  const { data, error } = await createClient()
    .from('topics')
    .select('id,slug,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(name,is_published)')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('category.is_published', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const relation = Array.isArray(data.category) ? data.category[0] : data.category;
  return {
    id: data.id,
    slug: data.slug,
    category: relation?.name ?? '',
    question: data.question,
    answer: data.answer,
    explanation: data.explanation,
    catechism: { paragraphs: data.catechism_paragraphs ?? [], text: data.catechism_text },
    scripture: { reference: data.scripture_reference, text: data.scripture_text },
  } satisfies Topic;
}

async function loadNativeGeneralFeedPage(cursor: GeneralFeedCursor | null = null): Promise<CataloguePage> {
  const response = await fetch(new URL('/api/content/general-feed', siteConfig.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ cursor }),
  });
  const result = await response.json() as { topics?: Topic[]; nextCursor?: GeneralFeedCursor | null; error?: string };
  if (!response.ok || !Array.isArray(result.topics) || result.nextCursor === undefined) {
    throw new Error(result.error ?? 'Unable to load the general feed.');
  }
  return { topics: result.topics, nextCursor: result.nextCursor };
}

function isRecommendationCursor(cursor: CatalogueCursor | GeneralFeedCursor | RecommendationCursor): cursor is RecommendationCursor {
  return 'userId' in cursor && typeof cursor.userId === 'string';
}

function isGeneralFeedCursor(cursor: CatalogueCursor | GeneralFeedCursor | RecommendationCursor): cursor is GeneralFeedCursor {
  return 'categories' in cursor && !('userId' in cursor);
}

async function loadNativeLiveTopicPage(cursor?: CatalogueCursor) {
  let query = createClient()
    .from('topics')
    .select('id,slug,order_index,question,answer,explanation,catechism_paragraphs,catechism_text,scripture_reference,scripture_text,category:categories!inner(name,is_published)')
    .eq('is_published', true)
    .eq('category.is_published', true)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true })
    .limit(51);
  if (cursor) {
    query = query.or(
      'order_index.gt.' + cursor.orderIndex +
      ',and(order_index.eq.' + cursor.orderIndex + ',id.gt.' + cursor.id + ')'
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<NativeLiveTopicRow & { order_index: number }>;
  const hasMore = rows.length > 50;
  const pageRows = hasMore ? rows.slice(0, 50) : rows;
  const topics = pageRows.map((row) => {
    const relation = Array.isArray(row.category) ? row.category[0] : row.category;
    return {
      id: row.id,
      slug: row.slug,
      category: relation?.name ?? '',
      question: row.question,
      answer: row.answer,
      explanation: row.explanation,
      catechism: { paragraphs: row.catechism_paragraphs ?? [], text: row.catechism_text },
      scripture: { reference: row.scripture_reference, text: row.scripture_text },
    } satisfies Topic;
  });
  const last = pageRows.at(-1);
  return {
    topics,
    nextCursor: hasMore && last ? { orderIndex: last.order_index, id: last.id } : null,
  };
}

type Route =
  | { kind: 'feed'; pathname: string }
  | { kind: 'search'; pathname: string; query: string }
  | { kind: 'learn'; pathname: string }
  | { kind: 'categories'; pathname: string }
  | { kind: 'account'; pathname: string }
  | { kind: 'about' | 'faq' | 'contact' | 'privacy' | 'terms' | 'cookies'; pathname: string }
  | { kind: 'signup'; pathname: string }
  | { kind: 'bookmarks'; pathname: string }
  | { kind: 'appeal'; pathname: string }
  | { kind: 'notifications'; pathname: string }
  | { kind: 'admin'; pathname: string; section: 'dashboard' | 'reports' | 'appeals' | 'content'; page: number }
  | { kind: 'category'; pathname: string; slug: string }
  | { kind: 'profile'; pathname: string; username: string }
  | { kind: 'topic'; pathname: string; slug: string; comments: boolean };

function parseRoute(href: string): Route | null {
  try {
    const url = new URL(href, 'https://native.cathoscroll.invalid');
    if (url.origin !== 'https://native.cathoscroll.invalid') return null;
    const pathname = url.pathname;
    if (pathname === '/') return { kind: 'feed', pathname };
    if (pathname === '/about') return { kind: 'about', pathname };
    if (pathname === '/faq') return { kind: 'faq', pathname };
    if (pathname === '/contact') return { kind: 'contact', pathname };
    if (pathname === '/privacy') return { kind: 'privacy', pathname };
    if (pathname === '/terms') return { kind: 'terms', pathname };
    if (pathname === '/cookies') return { kind: 'cookies', pathname };
    if (pathname === '/learn') return { kind: 'learn', pathname };
    if (pathname === '/search') {
      return { kind: 'search', pathname, query: url.searchParams.get('q') ?? '' };
    }
    if (pathname === '/categories') return { kind: 'categories', pathname };
    if (pathname === '/signin' || pathname === '/account') return { kind: 'account', pathname };
    if (pathname === '/account/personalization') return { kind: 'account', pathname: '/account' };
    if (pathname === '/account/security') return { kind: 'account', pathname: '/account' };
    if (pathname === '/signup') return { kind: 'signup', pathname };
    if (pathname === '/bookmarks') return { kind: 'bookmarks', pathname };
    if (pathname === '/appeal') return { kind: 'appeal', pathname };
    if (pathname === '/notifications') return { kind: 'notifications', pathname };
    if (pathname === '/admin') {
      const page = Number(url.searchParams.get('page') ?? '0');
      if (!Number.isSafeInteger(page) || page < 0) return null;
      return { kind: 'admin', pathname, section: 'dashboard', page };
    }
    const adminMatch = /^\/admin\/(reports|appeals|content)$/.exec(pathname);
    if (adminMatch) {
      const page = Number(url.searchParams.get('page') ?? '0');
      if (!Number.isSafeInteger(page) || page < 0) return null;
      return {
        kind: 'admin',
        pathname,
        section: adminMatch[1] as 'reports' | 'appeals' | 'content',
        page,
      };
    }
    const profileMatch = /^\/profile\/([^/]+)$/.exec(pathname);
    if (profileMatch) {
      const username = decodeURIComponent(profileMatch[1]);
      if (!username || username.trim() !== username || username.includes('/')) return null;
      return { kind: 'profile', pathname, username };
    }

    const match = /^\/(topic|categories)\/([^/]+)$/.exec(pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[2]);
    if (!slug || slug.trim() !== slug || slug.includes('/')) return null;
    return match[1] === 'topic'
      ? {
          kind: 'topic',
          pathname,
          slug,
          comments: url.hash === '#comments' || /^#comment-\d+$/.test(url.hash),
        }
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
  active?: boolean;
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
  const getAnalyticsAccessToken = useCallback(async (expectedUserId?: string) => {
    const { data, error } = await createClient().auth.getSession();
    if (error) {
      console.error('Unable to obtain native analytics session:', error.message);
      return null;
    }
    if (!data.session || (expectedUserId && data.session.user.id !== expectedUserId)) return null;
    return data.session.access_token;
  }, []);
  const navigation = useContext(TopicNavigation);
  if (!navigation) throw new Error('Native topic navigation is unavailable.');
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
    if (props.active === false || !userId || !accountActivity || !accountReady) return;
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
  }, [props.active, accountActivity, accountReady, userId, topicId, navigation.activityVersion, refresh]);

  useEffect(() => {
    if (props.active === false) return;
    let active = true;
    async function load() {
      setCountError('');
      if (countCache) {
        try {
          const cached = await countCache.load(topicId);
          if (!active) return;
          if (cached) setCounts({ topicId, value: cached, fresh: false });
          else if (!navigator.onLine) setCounts(null);
        } catch (error) {
          console.error('Unable to load cached topic counts:', error);
          if (active) setCountError('Saved topic counts could not be loaded.');
        }
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
        if (countCache) {
          try {
            await countCache.save(topicId, result.likes, result.comments);
          } catch (error) {
            console.error('Unable to save topic counts:', error);
            if (active) setCountError('Topic counts could not be saved for offline viewing.');
          }
        }
      } catch (error) {
        console.error('Unable to refresh topic counts:', error);
        if (active) {
          setCounts((previous) => (previous?.topicId === topicId ? previous : null));
          setCountError('Topic counts could not be updated and may be out of date.');
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.active, countCache, topicId, refresh, navigation.activityVersion]);

  useEffect(() => {
    if (props.active === false) return;
    const update = () => setRefresh((version) => version + 1);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [props.active]);

  useEffect(() => {
    if (props.active === false) return;
    const noticeId = 'topic-counts:' + topicId;
    if (!countError) {
      clearNativeStatusNotice(noticeId);
      return;
    }
    notifyNativeStatus(countError, {
      id: noticeId,
      action: { label: 'Retry', onClick: () => setRefresh((version) => version + 1) },
    });
  }, [props.active, countError, topicId]);

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
      <div className="min-h-0 flex-1">
        <TopicSwipeViewer
          {...props}
          active={props.active !== false && navigation.feedActive}
          analyticsEndpoint={`${siteConfig.url.replace(/\/+$/, '')}/api/analytics/feed-events`}
          getAnalyticsAccessToken={getAnalyticsAccessToken}
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
          displayCounts={counts?.value ?? null}
          currentActivityError={Boolean(userId && accountReady && activityError)}
          actionError={message}
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
  cache: OfflineCommentCache | null;
  noteCache: NativeNoteCache | null;
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
    async function load() {
      try {
        let result: Topic | null;
        if (navigator.onLine) {
          try {
            result = await loadNativeLiveTopicBySlug(slug);
            clearNativeStatusNotice('topic-fallback:' + slug);
          } catch (onlineError) {
            console.error('Unable to load live topic:', onlineError);
            result = await catalogue.topic(slug);
            notifyNativeStatus('Live topic content is unavailable. Showing the saved version.', {
              id: 'topic-fallback:' + slug,
              action: { label: 'Retry', onClick: () => setAttempt((value) => value + 1) },
            });
          }
        } else {
          result = await catalogue.topic(slug);
        }
        if (!active) return;
        setTopic(result);
        setError('');
        clearNativeStatusNotice('topic-page:' + slug);
        setLoading(false);
      } catch (cause) {
        console.error('Unable to load topic:', cause);
        if (!active) return;
        setError('Unable to load this topic. Please try again.');
        notifyNativeStatus('Unable to load this topic. Please try again.', {
          id: 'topic-page:' + slug,
          action: {
            label: 'Retry',
            onClick: () => {
              setError('');
              setLoading(true);
              setAttempt((value) => value + 1);
            },
          },
        });
        setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
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
        <NativeArticleSkeleton />
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
          <NativeNotes
            key={`${userId ?? 'anonymous'}:${topic.id}`}
            userId={userId}
            topicId={String(topic.id)}
            cache={noteCache}
          />
          <CommentSection
            topicId={String(topic.id)}
            cache={cache ?? undefined}
            serverActionsAvailable
            supabaseClient={createClient()}
          />
        </>
      )}
    </div>
  );
}


function App() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogue | null>(null);
  const generalFeedCacheRef = useRef<OfflineRankedFeedCache | null>(null);
  const personalizedFeedCacheRef = useRef<OfflineRankedFeedCache | null>(null);
  const pendingServiceImprovementCacheRefreshUserIdRef = useRef<string | null>(null);
  const [firstPage, setFirstPage] = useState<CataloguePage | null>(null);
  const [feedPersonalized, setFeedPersonalized] = useState(false);
  const [feedGeneralRanked, setFeedGeneralRanked] = useState(false);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [feedLoadError, setFeedLoadError] = useState('');
  const [catalogueRefresh, setCatalogueRefresh] = useState<CatalogueRefresh | null>(null);
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  const [catalogueMessage, setCatalogueMessage] = useState('');
  const [commentCache, setCommentCache] = useState<OfflineCommentCache | null>(null);
  const [countCache, setCountCache] = useState<OfflineTopicCountCache | null>(null);
  const [noteCache, setNoteCache] = useState<NativeNoteCache | null>(null);
  const [href, setHref] = useState(currentHref);
  const route = parseRoute(href);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [checkingAccount, setCheckingAccount] = useState(true);
  const [user, setUser] = useState<CachedIdentity | null>(null);
  const feedUserIdRef = useRef<string | null>(null);
  const [feedSnapshotUserId, setFeedSnapshotUserId] = useState<string | null>(null);
  const feedSnapshotMatchesUser = feedSnapshotUserId === (user?.id ?? null);
  const [activity, setActivity] = useState<NativeActivity | null>(null);
  const [activityStatus, setActivityStatus] = useState<NativeActivityStatus | null>(null);
  const [activityVersion, setActivityVersion] = useState(0);
  const [activityAttempt, setActivityAttempt] = useState(0);
  const retryStartup = useRef<() => void>(() => {});
  const getNativeSponsorAccessToken = useCallback(async (expectedUserId?: string) => {
    const { data, error } = await createClient().auth.getSession();
    if (error) {
      console.error('Unable to obtain the native sponsor analytics session:', error.message);
      return null;
    }
    if (!data.session || (expectedUserId && data.session.user.id !== expectedUserId)) return null;
    return data.session.access_token;
  }, []);
  const getSponsorAccessToken = useCallback(
    () => getNativeSponsorAccessToken(user?.id),
    [getNativeSponsorAccessToken, user?.id]
  );

  useEffect(() => {
    const retryPendingConsentSync = () => setFeedAttempt((attempt) => attempt + 1);
    window.addEventListener('online', retryPendingConsentSync);
    return () => window.removeEventListener('online', retryPendingConsentSync);
  }, []);

  useEffect(() => {
    if (!catalogue || authStatus !== 'ready') return;
    const nextFeedUserId = user?.id ?? null;
    if (feedUserIdRef.current !== nextFeedUserId) {
      feedUserIdRef.current = nextFeedUserId;
      setFeedSnapshotUserId(nextFeedUserId);
      setFirstPage(null);
    }
    const localCatalogue = catalogue;
    let active = true;
    let controller: AbortController | null = null;

    async function loadFeed() {
      controller = new AbortController();
      try {
        if (
          user?.id &&
          pendingServiceImprovementCacheRefreshUserIdRef.current === user.id &&
          personalizedFeedCacheRef.current
        ) {
          await personalizedFeedCacheRef.current.clearPersonalizedPages(user.id);
          pendingServiceImprovementCacheRefreshUserIdRef.current = null;
        }

        const localAnalyticsConsent = user?.id ? readAnalyticsConsent(user.id) : null;
        const serviceImprovementWithdrawalPending =
          localAnalyticsConsent?.serviceImprovement === false && localAnalyticsConsent.syncPending === true;

        if (!navigator.onLine) {
          let page: CataloguePage | null = null;
          let offlinePersonalized = false;
          let offlineGeneralRanked = false;
          if (!serviceImprovementWithdrawalPending && user?.id && personalizedFeedCacheRef.current &&
              await personalizedFeedCacheRef.current.hasFreshConsent(user.id)) {
            page = await personalizedFeedCacheRef.current.load('personalized', user.id, null) as CataloguePage | null;
            offlinePersonalized = Boolean(page);
          }
          if (!page && generalFeedCacheRef.current) {
            page = await generalFeedCacheRef.current.load('general', null, null) as CataloguePage | null;
            offlineGeneralRanked = Boolean(page);
          }
          if (!page) page = await localCatalogue.topics();
          if (!active) return;
          setFirstPage(page);
          setFeedLoadError('');
          setFeedPersonalized(offlinePersonalized);
          setFeedGeneralRanked(offlineGeneralRanked);
          clearNativeStatusNotice('feed-online');
          return;
        }

        let page: CataloguePage;
        let personalizedEnabled = false;
        if (user?.id) {
          const pendingConsent = await personalizedFeedCacheRef.current?.getPendingConsent(user.id);
          if (pendingConsent === false) {
            const { error: withdrawalError } = await createClient().rpc('set_my_personalization_consent', { p_enabled: false });
            if (!withdrawalError) {
              await personalizedFeedCacheRef.current?.setConsent(user.id, false, false);
              // Release the queued account-analytics preference only after
              // the server has accepted the linked personalisation withdrawal.
              window.dispatchEvent(new Event(analyticsConsentSyncEvent));
            }
          }
          const { data: status, error: statusError } =
            await createClient().rpc('get_my_personalization_status');
          personalizedEnabled =
            !serviceImprovementWithdrawalPending &&
            pendingConsent !== false &&
            !statusError &&
            typeof status === 'object' &&
            status !== null &&
            'enabled' in status &&
            status.enabled === true;
          if (pendingConsent !== false && !statusError && typeof status === 'object' && status !== null &&
              'enabled' in status && typeof status.enabled === 'boolean') {
            try {
              await personalizedFeedCacheRef.current?.setConsent(user.id, status.enabled);
            } catch (cacheError) {
              console.error('Unable to update cached personalisation consent:', cacheError);
            }
          }
        }
        if (personalizedEnabled) {
          const { data, error } = await createClient().rpc('get_my_recommendation_page', {
            feed_cursor: null,
            page_limit: 50,
          });
          if (error) throw error;
          if (!data || typeof data !== 'object' || !Array.isArray(data.topics) || !('nextCursor' in data)) {
            throw new Error('The recommendation service returned an invalid page.');
          }
          page = data as CataloguePage;
          if (user?.id && personalizedFeedCacheRef.current) {
            try { await personalizedFeedCacheRef.current.save('personalized', user.id, null, page); }
            catch (cacheError) { console.error('Unable to cache the ranked personalised feed:', cacheError); }
          }
        } else {
          page = await loadNativeGeneralFeedPage();
          try { await generalFeedCacheRef.current?.save('general', null, null, page); }
          catch (cacheError) { console.error('Unable to cache the ranked general feed:', cacheError); }
        }
        if (!active) return;
        setFirstPage(page);
        setFeedLoadError('');
        setFeedPersonalized(personalizedEnabled);
        setFeedGeneralRanked(!personalizedEnabled);
        clearNativeStatusNotice('feed-online');
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        console.error('Unable to load the online topic feed:', cause);
        try {
          let page: CataloguePage | null = null;
          let offlinePersonalized = false;
          let offlineGeneralRanked = false;
          if (user?.id && personalizedFeedCacheRef.current &&
              await personalizedFeedCacheRef.current.hasFreshConsent(user.id)) {
            page = await personalizedFeedCacheRef.current.load('personalized', user.id, null) as CataloguePage | null;
            offlinePersonalized = Boolean(page);
          }
          if (!page && generalFeedCacheRef.current) {
            page = await generalFeedCacheRef.current.load('general', null, null) as CataloguePage | null;
            offlineGeneralRanked = Boolean(page);
          }
          if (!page) page = await localCatalogue.topics();
          if (!active) return;
          setFirstPage(page);
          setFeedLoadError('');
          setFeedPersonalized(offlinePersonalized);
          setFeedGeneralRanked(offlineGeneralRanked);
          notifyNativeStatus('The live feed is unavailable. Showing your most recently saved ranked feed where available.', {
            id: 'feed-online',
            action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
          });
        } catch (offlineCause) {
          console.error('Unable to load the saved topic feed:', offlineCause);
          if (active) {
            setFeedLoadError('The topic feed could not be loaded. Check your connection or retry.');
            notifyNativeStatus('The topic feed could not be loaded. Please retry.', {
              id: 'feed-online',
              action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
            });
          }
        }
      }
    }

    void loadFeed();
    return () => {
      active = false;
      controller?.abort();
    };
  }, [catalogue, authStatus, user?.id, feedAttempt]);

  useEffect(() => {
    if (authStatus === 'unavailable') {
      notifyNativeStatus('Sign-in is unavailable. Check your connection and restart the app if the problem continues.', {
        id: 'auth-unavailable',
      });
    } else {
      clearNativeStatusNotice('auth-unavailable');
    }
  }, [authStatus]);

  useEffect(() => {
    if (!parseRoute(href)) {
      notifyNativeStatus('This page is not available in the app. Please use the website.', {
        id: 'unsupported-route',
      });
    } else {
      clearNativeStatusNotice('unsupported-route');
    }
  }, [href]);

  useEffect(() => {
    if (!error) {
      clearNativeStatusNotice('startup');
      return;
    }
    notifyNativeStatus(error, {
      id: 'startup',
      action: {
        label: 'Retry',
        onClick: () => {
          clearNativeStatusNotice('startup');
          retryStartup.current();
        },
      },
    });
  }, [error]);

  useEffect(() => {
    if (!catalogueMessage) {
      clearNativeStatusNotice('catalogue-refresh');
      return;
    }
    notifyNativeStatus(catalogueMessage, { id: 'catalogue-refresh' });
  }, [catalogueMessage]);

  useEffect(() => {
    function readPersonalizationConsentCache(event: Event) {
      const detail = (event as CustomEvent<{
        userId?: unknown;
        complete?: (result: Promise<{ available: boolean; consent: CachedPersonalizationConsent | null }>) => void;
      }>).detail;
      if (!detail || typeof detail.userId !== 'string') return;
      const cache = personalizedFeedCacheRef.current;
      const result = cache
        ? cache.getCachedConsent(detail.userId).then((consent) => ({ available: true, consent }))
        : Promise.resolve({ available: false, consent: null });
      detail.complete?.(result);
    }
    window.addEventListener('cathoscroll:personalization-consent-status-request', readPersonalizationConsentCache);
    return () => window.removeEventListener('cathoscroll:personalization-consent-status-request', readPersonalizationConsentCache);
  }, []);

  useEffect(() => {
    function syncPersonalizationConsent(event: Event) {
      const detail = (event as CustomEvent<{
        userId?: unknown;
        enabled?: unknown;
        pendingSync?: unknown;
        complete?: (result: Promise<void>) => void;
      }>).detail;
      if (!detail || typeof detail.userId !== 'string' || typeof detail.enabled !== 'boolean') return;
      const cache = personalizedFeedCacheRef.current;
      const result = cache
        ? cache.setConsent(detail.userId, detail.enabled, detail.pendingSync === true).then(() => {
            // Immediately replace the personalised feed after local withdrawal;
            // the next feed load also retries any pending server withdrawal.
            // Unmount the stale page immediately, but let loadFeed publish
            // the replacement page and ranking mode together to keep cursors aligned.
            setFirstPage(null);
            setFeedAttempt((attempt) => attempt + 1);
          })
        : Promise.reject(new Error('Encrypted personalised feed cache is unavailable.'));
      detail.complete?.(result);
    }
    window.addEventListener('cathoscroll:personalization-consent-changed', syncPersonalizationConsent);
    return () => window.removeEventListener('cathoscroll:personalization-consent-changed', syncPersonalizationConsent);
  }, []);

  useEffect(() => {
    function clearPassiveSignalRecommendations(event: Event) {
      const detail = (event as CustomEvent<{
        userId?: unknown;
        choice?: unknown;
        consent?: { serviceImprovement?: unknown; syncPending?: unknown };
      }>).detail;
      if (!detail || typeof detail.userId !== 'string') return;
      const serviceImprovementNeedsRefresh =
        detail.choice === 'serviceImprovement' ||
        detail.consent?.serviceImprovement === false ||
        (detail.consent?.serviceImprovement === true && detail.consent.syncPending === false);
      if (!serviceImprovementNeedsRefresh) return;

      const cache = personalizedFeedCacheRef.current;
      if (!user?.id || detail.userId !== user.id || !cache) {
        pendingServiceImprovementCacheRefreshUserIdRef.current = detail.userId;
        return;
      }
      pendingServiceImprovementCacheRefreshUserIdRef.current = null;
      void cache.clearPersonalizedPages(user.id).then(() => {
        // Cached personalised pages may have been ranked using passive reading
        // signals. Remove them immediately while preserving the separate
        // Personalisation grant; offline reading falls back to the cached general feed or local catalogue.
        setFirstPage(null);
        setFeedAttempt((attempt) => attempt + 1);
      }).catch((cause: unknown) => {
        console.error('Unable to clear passive-signal personalised feed pages:', cause);
        notifyNativeStatus('Saved personalised pages could not be refreshed after analytics consent changed.', {
          id: 'personalized-feed-cache',
        });
      });
    }

    window.addEventListener(analyticsConsentChangeEvent, clearPassiveSignalRecommendations);
    return () => window.removeEventListener(analyticsConsentChangeEvent, clearPassiveSignalRecommendations);
  }, [user?.id]);

  useEffect(() => {
    const message = activityStatus && activityStatus.userId === user?.id ? activityStatus.error : '';
    if (!message) {
      clearNativeStatusNotice('account-activity');
      return;
    }
    notifyNativeStatus(message, {
      id: 'account-activity',
      action: activity ? undefined : {
        label: 'Retry',
        onClick: () => setActivityAttempt((attempt) => attempt + 1),
      },
    });
  }, [activityStatus, activity, user?.id]);


  useEffect(() => {
    let active = true;
    let openingContent = false;
    let unsubscribe: (() => void) | undefined;
    let removeConnectivityListeners: (() => void) | undefined;
    async function openContent() {
      if (!active || openingContent) return;
      openingContent = true;
      let failure = 'Unable to open app storage. Please try again.';
      try {
        const databases = await openNativeDatabases(secureAuthStorage);
        // Remove the retired signed-out analytics queue and its stored events from existing installs.
        await databases.catalogue.execute('DROP TABLE IF EXISTS offline_anonymous_analytics_outbox');
        const localCatalogue = new OfflineCatalogue(databases.catalogue);
        try {
          const generalCache = new OfflineRankedFeedCache(databases.catalogue, localCatalogue);
          await generalCache.initialize();
          generalFeedCacheRef.current = generalCache;
          clearNativeStatusNotice('general-feed-cache');
        } catch (cacheError) {
          console.error('Offline general-ranked feed cache is unavailable:', cacheError);
          notifyNativeStatus('The latest general feed order may not be available offline.', { id: 'general-feed-cache' });
        }
        let cacheDatabase = databases.catalogue;
        let privateDatabaseReady = false;
        try {
          await openPrivateActivity();
          cacheDatabase = await openPrivateActivityDatabase(secureAuthStorage);
          privateDatabaseReady = true;
          clearNativeStatusNotice('private-cache-unavailable');
        } catch (cause) {
          // Keep public browsing and online reading available if secure storage
          // is unavailable. Note contents remain encrypted by NativeNoteCache.
          console.error('Encrypted offline cache is unavailable:', cause);
          notifyNativeStatus('Encrypted offline account storage is unavailable. Saved notes and activity may not be available offline.', {
            id: 'private-cache-unavailable',
          });
        }
        if (privateDatabaseReady) {
          try {
            const personalizedCache = new OfflineRankedFeedCache(cacheDatabase, localCatalogue, true);
            await personalizedCache.initialize();
            personalizedFeedCacheRef.current = personalizedCache;
          } catch (cacheError) {
            console.error('Encrypted personalised feed cache is unavailable:', cacheError);
            notifyNativeStatus('Offline personalised feed pages are unavailable. The general ranked feed remains available.', {
              id: 'personalized-feed-cache',
            });
          }
          try {
            await resetLegacySignedInAnalyticsOutbox(cacheDatabase);
            const signedInOutbox = new NativeSignedInAnalyticsOutbox(cacheDatabase);
            await Promise.all([
              configureFeedAnalyticsOutbox(signedInOutbox),
              configureFeedCardAnalyticsOutbox(signedInOutbox),
              configureSponsorAnalyticsOutbox(signedInOutbox),
            ]);
            clearNativeStatusNotice('signed-in-analytics-outbox');
          } catch (cause) {
            console.error('Encrypted signed-in analytics outbox is unavailable:', cause);
            notifyNativeStatus('Signed-in topic and comment analytics may not be retained if the app closes before upload.', {
              id: 'signed-in-analytics-outbox',
            });
          }
        }
        const localComments = new OfflineCommentCache(cacheDatabase);
        const localCounts = new OfflineTopicCountCache(cacheDatabase);
        const localNotes = new NativeNoteCache(cacheDatabase, secureAuthStorage);
        let commentsReady = false;
        let countsReady = false;
        let notesReady = false;
        try {
          await localComments.initialize();
          commentsReady = true;
        } catch (cause) {
          console.error('Offline comment cache is unavailable:', cause);
          notifyNativeStatus('Saved comments are unavailable on this device. The live feed can still be used.', {
            id: 'comments-cache-unavailable',
          });
        }
        try {
          await localCounts.initialize();
          countsReady = true;
        } catch (cause) {
          console.error('Offline topic-count cache is unavailable:', cause);
          notifyNativeStatus('Saved topic counts are unavailable on this device. Live counts can still be loaded.', {
            id: 'counts-cache-unavailable',
          });
        }
        try {
          await localNotes.initialize();
          notesReady = true;
        } catch (cause) {
          console.error('Offline notes cache is unavailable:', cause);
          notifyNativeStatus('Saved notes are unavailable on this device.', {
            id: 'notes-cache-unavailable',
          });
        }
        failure = 'Unable to open saved topics. Please try again.';
        const page = await localCatalogue.topics();
        if (active) {
          setError('');
          setFirstPage(page);
          setCatalogue(localCatalogue);
          setCommentCache(commentsReady ? localComments : null);
          setCountCache(countsReady ? localCounts : null);
          setNoteCache(notesReady ? localNotes : null);
          try {
            setCatalogueRefresh(
              new CatalogueRefresh(
                databases.catalogue,
                new SupabaseCatalogueTransport(createClient())
              )
            );
          } catch (cause) {
            console.error('Unable to set up topic updates:', cause);
            setCatalogueMessage("Couldn't update topics. Showing saved topics.");
          }
        }
      } catch (cause) {
        console.error(failure, cause);
        if (active) {
          const detail = cause instanceof Error ? cause.message : 'Unknown startup error.';
          setError(`${failure} ${detail.slice(0, 240)}`);
        }
      } finally {
        openingContent = false;
      }
    }
    async function start() {
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
            const previousUserId = cachedIdentity?.id ?? null;
            cachedIdentity = identityAfterAuthEvent(event, session, cachedIdentity);
            const nextUserId = cachedIdentity?.id ?? null;
            if (previousUserId && previousUserId !== nextUserId) {
              void Promise.all([
                clearFeedAnalyticsOutbox(previousUserId),
                clearFeedCardAnalyticsOutbox(previousUserId),
                clearSponsorAnalyticsOutbox(previousUserId),
                personalizedFeedCacheRef.current?.clearUser(previousUserId),
              ]).catch((cause: unknown) => {
                console.error('Unable to clear the previous account analytics queue:', cause);
                notifyNativeStatus('Some unsent analytics from the previous account could not be cleared from this device.', {
                  id: 'signed-in-analytics-clear',
                });
              });
            }
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
      retryStartup.current = () => void openContent();
      await openContent();
    }
    void start();
    return () => {
      active = false;
      retryStartup.current = () => {};
      unsubscribe?.();
      removeConnectivityListeners?.();
    };
  }, []);

  useEffect(() => {
    if (!catalogueRefresh || !catalogue) return;
    const service = catalogueRefresh;
    let active = true;
    let lastAttempt = 0;
    let running = false;
    let retryAfterReconnect = false;
    let uiNeedsReload = false;
    const controller = new AbortController();
    async function refresh() {
      if (!active || running || !navigator.onLine || Date.now() - lastAttempt < 30000) return;
      lastAttempt = Date.now();
      running = true;
      try {
        await service.initialize();
        if (await service.refresh(controller.signal)) uiNeedsReload = true;
        if (uiNeedsReload) {
          // A catalogue refresh updates the offline browse cache, not the live
          // personalized feed. Replacing its first page would also mismatch
          // the server-owned recommendation cursor used by subsequent pages.
          // Keep the active feed snapshot untouched. New catalogue content is
          // picked up when a new feed session starts, not during background sync.
          if (!active) return;
          setCatalogueVersion((version) => version + 1);
          uiNeedsReload = false;
        }
        if (active) setCatalogueMessage('');
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        console.error('Unable to update saved topics:', cause);
        setCatalogueMessage("Couldn't update topics. Showing saved topics.");
      } finally {
        running = false;
        if (active && retryAfterReconnect) {
          retryAfterReconnect = false;
          lastAttempt = 0;
          void refresh();
        }
      }
    }
    const request = () => {
      void refresh();
    };
    const reconnect = () => {
      lastAttempt = 0;
      if (running) retryAfterReconnect = true;
      else request();
    };
    const resume = () => {
      if (document.visibilityState === 'visible') request();
    };
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', request);
    document.addEventListener('visibilitychange', resume);
    const timer = window.setInterval(request, 5 * 60 * 1000);
    request();
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', request);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [catalogueRefresh, catalogue]);

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
        notifyNativeStatus('This page is not available in the app. Please use the website.', { id: 'navigation' });
        return;
      }
      window.history.pushState(null, '', `#${target}`);
      setHref(target);
      window.scrollTo(0, 0);
    }
    function restore() {
      setHref(currentHref());
      window.scrollTo(0, 0);
    }
    function interceptInternalLinks(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname.startsWith('/api/')) return;
      event.preventDefault();
      const next = destination.pathname + destination.search + destination.hash;
      window.dispatchEvent(new CustomEvent('cathoscroll:navigate', { detail: next }));
    }

    window.addEventListener('cathoscroll:navigate', navigate);
    window.addEventListener('popstate', restore);
    document.addEventListener('click', interceptInternalLinks, true);
    return () => {
      window.removeEventListener('cathoscroll:navigate', navigate);
      window.removeEventListener('popstate', restore);
      document.removeEventListener('click', interceptInternalLinks, true);
    };
  }, []);

  const loadPage = useCallback(
    async (cursor: CatalogueCursor | GeneralFeedCursor | RecommendationCursor) => {
      if (!catalogue) throw new Error('The offline catalogue is not ready.');
      if (isRecommendationCursor(cursor)) {
        try {
          if (!navigator.onLine) throw new Error('The device is offline.');
          const { data, error } = await createClient().rpc('get_my_recommendation_page', {
            feed_cursor: cursor,
            page_limit: 50,
          });
          if (error) throw error;
          if (!data || typeof data !== 'object' || !Array.isArray(data.topics) || !('nextCursor' in data)) {
            throw new Error('The recommendation service returned an invalid page.');
          }
          const page = data as { topics: Topic[]; nextCursor: RecommendationCursor | null };
          if (user?.id && personalizedFeedCacheRef.current) {
            try { await personalizedFeedCacheRef.current.save('personalized', user.id, cursor, page); }
            catch (cacheError) { console.error('Unable to cache a personalised feed page:', cacheError); }
          }
          clearNativeStatusNotice('feed-pagination');
          return page;
        } catch (cause) {
          console.error('Unable to continue personalized feed pagination:', cause);
          if (user?.id && personalizedFeedCacheRef.current &&
              await personalizedFeedCacheRef.current.hasFreshConsent(user.id)) {
            const cachedPage = await personalizedFeedCacheRef.current.load('personalized', user.id, cursor);
            if (cachedPage) return cachedPage as { topics: Topic[]; nextCursor: RecommendationCursor | null };
          }
          const rankedGeneral = await generalFeedCacheRef.current?.load('general', null, null);
          if (rankedGeneral) {
            setFirstPage(rankedGeneral as CataloguePage);
            setFeedPersonalized(false);
            setFeedGeneralRanked(true);
            notifyNativeStatus('Personalised recommendations are unavailable. Continuing with the saved general ranking.', {
              id: 'feed-pagination',
              action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
            });
            return rankedGeneral as CataloguePage;
          }
          const page = await catalogue.topics();
          setFirstPage(page);
          setFeedPersonalized(false);
          setFeedGeneralRanked(false);
          notifyNativeStatus('Personalised recommendations are unavailable. Showing saved topics instead.', {
            id: 'feed-pagination',
            action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
          });
          return page;
        }
      }
      if (isGeneralFeedCursor(cursor)) {
        try {
          if (!navigator.onLine) throw new Error('The device is offline.');
          const page = await loadNativeGeneralFeedPage(cursor);
          try { await generalFeedCacheRef.current?.save('general', null, cursor, page); }
          catch (cacheError) { console.error('Unable to cache a general feed page:', cacheError); }
          clearNativeStatusNotice('feed-pagination');
          return page;
        } catch (cause) {
          console.error('Unable to continue general feed pagination:', cause);
          const cachedPage = await generalFeedCacheRef.current?.load('general', null, cursor);
          if (cachedPage) return cachedPage as { topics: Topic[]; nextCursor: GeneralFeedCursor | null };
          const page = await catalogue.topics();
          setFirstPage(page);
          setFeedGeneralRanked(false);
          notifyNativeStatus('The ranked general feed is unavailable. Showing saved topics instead.', {
            id: 'feed-pagination',
            action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
          });
          return page;
        }
      }
      if (navigator.onLine) {
        try {
          const page = await loadNativeLiveTopicPage(cursor);
          clearNativeStatusNotice('feed-pagination');
          return page;
        } catch (cause) {
          console.error('Unable to load the live topic page:', cause);
          notifyNativeStatus('Live topic updates are unavailable. Showing saved topics.', {
            id: 'feed-pagination',
          });
        }
      }
      return catalogue.topics({ cursor });
    },
    [catalogue, user]
  );

  return (
    <ThemeProvider>
      <AnalyticsConsentManager
        userId={user?.id ?? null}
        loading={authStatus === 'loading' || checkingAccount}
        apiBaseUrl={siteConfig.url}
        getAccessToken={getNativeSponsorAccessToken}
      />
      <SponsorAnalyticsSync
        apiBaseUrl={siteConfig.url}
        userId={user?.id ?? null}
        getAccessToken={getSponsorAccessToken}
      />
      <SignInPromptProvider>
        <NativeNotificationsProvider userId={user?.id ?? null}>
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
            <NativeNavbar pathname={route?.pathname ?? '/'} userId={user?.id ?? null} />
            <main className="native-content">
              {route?.kind === 'feed' && !error && !feedLoadError && !firstPage && (
                <NativeFeedSkeleton />
              )}
              {error && (
                <section className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
                  <h1 className="text-text-primary text-xl font-semibold">CathoScroll could not finish starting</h1>
                  <p className="text-text-secondary text-sm">{error}</p>
                  <button type="button" className="bg-accent rounded-lg px-5 py-3 text-sm font-semibold text-white" onClick={() => { setError(''); retryStartup.current(); }}>Retry startup</button>
                </section>
              )}
              {route?.kind === 'feed' && feedLoadError && !error && (
                <section className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
                  <h1 className="text-text-primary text-xl font-semibold">Your feed is unavailable</h1>
                  <p className="text-text-secondary text-sm">{feedLoadError}</p>
                  <button type="button" className="bg-accent rounded-lg px-5 py-3 text-sm font-semibold text-white" onClick={() => { setFeedLoadError(''); setFeedAttempt((value) => value + 1); }}>Retry feed</button>
                </section>
              )}
              {!error && route?.kind === 'search' && !catalogue && (
                <NativeGridSkeleton label="Loading search" />
              )}
              {!error && route?.kind === 'categories' && !catalogue && (
                <NativeCategorySkeleton label="Loading categories" />
              )}
              {!error && route?.kind === 'bookmarks' && !catalogue && (
                <NativeGridSkeleton label="Loading bookmarks" />
              )}
              {!error && route?.kind === 'category' && !catalogue && (
                <NativeCategorySkeleton label="Loading category" />
              )}
              {!error &&
                route?.kind === 'topic' &&
                (!catalogue || !commentCache || !noteCache) && (
                  <NativeArticleSkeleton />
                )}
              {feedSnapshotMatchesUser && firstPage && !firstPage.topics.length && (
                <p className="px-6">No topics available.</p>
              )}
              {feedSnapshotMatchesUser && firstPage && firstPage.topics.length > 0 && (
                <div
                  className="h-[calc(100vh-4rem)] overflow-hidden"
                  hidden={route?.kind !== 'feed'}
                >
                  <TopicFeedCore
                    key={user?.id ?? 'signed-out'}
                    topics={firstPage.topics}
                    nextCursor={firstPage.nextCursor}
                    personalized={feedPersonalized}
                    generalRanked={feedGeneralRanked}
                    loadPage={loadPage}
                    userId={user?.id ?? null}
                    getSponsorAccessToken={getNativeSponsorAccessToken}
                    viewer={NativeViewer}
                    preservePositionOnUpdate
                    topCommentsEndpoint={new URL(
                      '/api/content/top-comments',
                      siteConfig.url
                    ).toString()}
                    onOpenComment={(comment: TopFeedComment) =>
                      openRoute(
                        `/topic/${encodeURIComponent(comment.topic_slug)}#comment-${comment.comment_id}`
                      )
                    }
                  />
                </div>
              )}
              {catalogue && route?.kind === 'search' && (
                <SearchPage
                  key={catalogueVersion}
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
              {catalogue && route?.kind === 'categories' && (
                <CategoriesPage key={catalogueVersion} catalogue={catalogue} />
              )}
              {route?.kind === 'admin' && (
                <NativeAdmin
                  key={user?.id ?? 'signed-out'}
                  userId={user?.id ?? null}
                  section={route.section}
                  page={route.page}
                />
              )}
              {route?.kind === 'about' && <AboutPage />}
              {route?.kind === 'faq' && <FAQPage />}
              {route?.kind === 'contact' && <ContactPage />}
              {route?.kind === 'privacy' && <PrivacyPage />}
              {route?.kind === 'terms' && <TermsPage />}
              {route?.kind === 'cookies' && <CookiesPage />}
              {route?.kind === 'learn' && <LearnContent />}
              {route?.kind === 'account' && (
                <NativeAccount
                  key={user?.id ?? 'signed-out'}
                  user={user}
                  checking={authStatus === 'loading' || checkingAccount}
                  available={authStatus !== 'unavailable'}
                  onSignedIn={() => openRoute('/account')}
                  onSignedOut={() => openRoute('/')}
                  activity={activity?.userId === user?.id ? activity : null}
                />
              )}
              {route?.kind === 'signup' &&
                (authStatus === 'loading' || checkingAccount ? (
                  <AccountPageSkeleton />
                ) : authStatus === 'unavailable' ? (
                  null
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
                  key={`${user?.id ?? 'signed-out'}-${catalogueVersion}`}
                  catalogue={catalogue}
                  userId={user?.id ?? null}
                  activity={activity?.userId === user?.id ? activity : null}
                  status={activityStatus}
                  version={activityVersion}
                />
              )}
              {route?.kind === 'appeal' && (
                <NativeAppeal
                  key={user?.id ?? 'signed-out'}
                  userId={user?.id ?? null}
                  onRequireSignIn={() => openRoute('/signin?next=%2Fappeal')}
                />
              )}
              {route?.kind === 'notifications' && (
                <NativeNotifications key={user?.id ?? 'signed-out'} userId={user?.id ?? null} />
              )}
              {route?.kind === 'profile' && (
                <NativePublicProfile key={route.username} username={route.username} />
              )}
              {catalogue && route?.kind === 'category' && (
                <CategoryPage
                  key={`${route.slug}-${catalogueVersion}`}
                  catalogue={catalogue}
                  slug={route.slug}
                />
              )}
              {catalogue && route?.kind === 'topic' && (
                <NativeTopicPage
                  key={`${route.slug}-${catalogueVersion}`}
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

            </main>
            <OfflineIndicator activity={activity?.userId === user?.id ? activity : null} activityVersion={activityVersion} />
          </TopicNavigation.Provider>
        </NativeNotificationsProvider>
      </SignInPromptProvider>
    </ThemeProvider>
  );
}

class NativeErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught native application render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-background text-text-primary flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold">CathoScroll encountered an error</h1>
          <p className="text-text-secondary max-w-xl text-sm">The app could not display this screen. Restart the app to try again.</p>
          <p className="text-text-muted max-w-xl break-words text-xs" role="status">Diagnostic: {this.state.error.message.slice(0, 240) || this.state.error.name}</p>
          <button type="button" className="bg-accent rounded-lg px-5 py-3 text-sm font-semibold text-white" onClick={() => window.location.reload()}>
            Restart app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(
  <NativeErrorBoundary>
    <App />
  </NativeErrorBoundary>
);
