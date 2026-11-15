import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { OfflineCatalogue, type CatalogueCursor } from '@/lib/offline/catalogue';
import { CatalogueRefresh } from '@/lib/offline/catalogue-refresh';
import { SupabaseCatalogueTransport } from '@/lib/offline/supabase-catalogue-transport';
import { OfflineCommentCache } from '@/lib/offline/comment-cache';
import { OfflineTopicCountCache, type CachedTopicCounts } from '@/lib/offline/topic-count-cache';
import { loadTopicActivity } from '@/lib/topic-activity';
import { siteConfig } from '@/lib/constants';
import type { RecommendationCursor } from '@/lib/recommendations';
import { openNativeDatabases, openPrivateActivityDatabase } from '@/lib/offline/native-database';
import { SupabaseActivityTransport } from '@/lib/offline/supabase-activity-transport';
import type { OfflineActivityKind, OfflineTopicActivity } from '@/lib/offline/activity-store';
import type { Topic } from '@/types';
import './style.css';

type CataloguePage = { topics: Topic[]; nextCursor: CatalogueCursor | RecommendationCursor | null };

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
        if (cached) setCounts({ topicId, value: cached, fresh: false });
        else if (!navigator.onLine) setCounts(null);
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

  useEffect(() => {
    const noticeId = 'topic-counts:' + topicId;
    if (!countError) {
      clearNativeStatusNotice(noticeId);
      return;
    }
    notifyNativeStatus(countError, {
      id: noticeId,
      action: { label: 'Retry', onClick: () => setRefresh((version) => version + 1) },
    });
  }, [countError, topicId]);

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
          <CommentSection topicId={String(topic.id)} cache={cache} serverActionsAvailable supabaseClient={createClient()} />
        </>
      )}
    </div>
  );
}


type NativeMfaGateState =
  | { kind: 'setup' }
  | { kind: 'verify'; factorId: string; challengeId: string | null };

function NativeMfaGate({ userId }: { userId: string | null }) {
  const [gate, setGate] = useState<NativeMfaGateState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!userId) {
      setGate(null);
      setCode('');
      return;
    }

    const supabase = createClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setGate(null);
      return;
    }

    const response = await fetch(
      `${siteConfig.url.replace(/\/+$/, '')}/api/admin/security/mfa-enforcement`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
    );
    if (!response.ok) throw new Error('Unable to check administrator security requirements.');
    const status = (await response.json()) as { enforcementEnabled?: boolean };
    if (status.enforcementEnabled !== true) {
      setGate(null);
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!adminRow) {
      setGate(null);
      return;
    }

    const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] =
      await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
    if (assuranceError) throw assuranceError;
    if (factorsError) throw factorsError;

    if (assurance.currentLevel === 'aal2' && assurance.nextLevel === 'aal2') {
      setGate(null);
      setError('');
      setMessage('');
      return;
    }

    const verifiedFactor = (factors.totp ?? []).find((factor) => factor.status === 'verified');
    if (!verifiedFactor) {
      setGate({ kind: 'setup' });
      return;
    }
    setGate({ kind: 'verify', factorId: verifiedFactor.id, challengeId: null });
  }, [userId]);

  useEffect(() => {
    let active = true;
    void refresh().catch((cause) => {
      if (active) {
        console.error('Unable to check native administrator MFA:', cause);
        setError('Unable to verify administrator security. Reconnect and try again.');
      }
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function startChallenge() {
    if (!gate || gate.kind !== 'verify') return;
    setBusy(true);
    setError('');
    try {
      const { data, error: challengeError } = await createClient().auth.mfa.challenge({
        factorId: gate.factorId,
      });
      if (challengeError) throw challengeError;
      setGate({ ...gate, challengeId: data.id });
      setMessage('Enter the current code from your authenticator app.');
    } catch (cause) {
      console.error('Unable to start native MFA challenge:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to start authenticator verification.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyChallenge() {
    if (!gate || gate.kind !== 'verify' || !gate.challengeId) return;
    if (!/^\d{6,8}$/.test(code.trim())) {
      setError('Enter the current six- to eight-digit authenticator code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: verifyError } = await createClient().auth.mfa.verify({
        factorId: gate.factorId,
        challengeId: gate.challengeId,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      setCode('');
      setMessage('Authenticator verified. Administrator access is available.');
      await refresh();
    } catch (cause) {
      console.error('Unable to verify native administrator MFA:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to verify authenticator code.');
    } finally {
      setBusy(false);
    }
  }

  if (!gate) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-mfa-title"
        className="bg-bg-secondary border-border w-full max-w-md rounded-2xl border p-6 shadow-2xl"
      >
        <p className="text-accent text-xs font-semibold uppercase tracking-wider">Administrator security</p>
        <h2 id="native-mfa-title" className="mt-2 text-2xl font-bold">
          {gate.kind === 'setup' ? 'Authenticator setup required' : 'Verify your authenticator'}
        </h2>
        {gate.kind === 'setup' ? (
          <>
            <p className="text-text-secondary mt-3 text-sm">
              Administrator MFA is enforced for this account, but no verified authenticator is available.
              Open CathoScroll on the website and complete Account → Security before continuing.
            </p>
            <button
              type="button"
              onClick={() => window.open(`${siteConfig.url}/account/security`, '_blank', 'noopener,noreferrer')}
              className="bg-accent mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white"
            >
              Open security settings
            </button>
          </>
        ) : (
          <>
            <p className="text-text-secondary mt-3 text-sm">
              Verify your identity to continue using administrator tools.
            </p>
            {!gate.challengeId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startChallenge()}
                className="bg-accent mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Preparing…' : 'Send authenticator challenge'}
              </button>
            ) : (
              <div className="mt-5 space-y-3">
                <label htmlFor="native-admin-mfa-code" className="block text-sm font-semibold">
                  Authenticator code
                </label>
                <input
                  id="native-admin-mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="border-border bg-background w-full rounded-xl border px-4 py-3"
                  placeholder="000000"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verifyChallenge()}
                  className="bg-accent w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Verifying…' : 'Verify and continue'}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm">{message}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void createClient().auth.signOut()}
          className="border-border mt-4 w-full rounded-xl border px-4 py-3 text-sm font-semibold"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

function App() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogue | null>(null);
  const [firstPage, setFirstPage] = useState<CataloguePage | null>(null);
  const [feedPersonalized, setFeedPersonalized] = useState(false);
  const [feedAttempt, setFeedAttempt] = useState(0);
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
  const [activity, setActivity] = useState<NativeActivity | null>(null);
  const [activityStatus, setActivityStatus] = useState<NativeActivityStatus | null>(null);
  const [activityVersion, setActivityVersion] = useState(0);
  const [activityAttempt, setActivityAttempt] = useState(0);
  const retryStartup = useRef<() => void>(() => {});

  useEffect(() => {
    if (!catalogue || authStatus !== 'ready') return;
    const localCatalogue = catalogue;
    let active = true;
    let controller: AbortController | null = null;

    async function loadFeed() {
      controller?.abort();
      controller = new AbortController();
      try {
        if (!navigator.onLine) {
          const page = await localCatalogue.topics();
          if (!active) return;
          setFirstPage(page);
          setFeedPersonalized(false);
          clearNativeStatusNotice('feed-online');
          return;
        }

        let page: CataloguePage;
        if (user?.id) {
          const { data, error } = await createClient().rpc('get_my_recommendation_page', {
            feed_cursor: null,
            page_limit: 50,
          });
          if (error) throw error;
          if (!data || typeof data !== 'object' || !Array.isArray(data.topics) || !('nextCursor' in data)) {
            throw new Error('The recommendation service returned an invalid page.');
          }
          page = data as CataloguePage;
        } else {
          page = await loadNativeLiveTopicPage();
        }
        if (!active) return;
        setFirstPage(page);
        setFeedPersonalized(Boolean(user?.id));
        clearNativeStatusNotice('feed-online');
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        console.error('Unable to load the online topic feed:', cause);
        try {
          const page = await localCatalogue.topics();
          if (!active) return;
          setFirstPage(page);
          setFeedPersonalized(false);
          notifyNativeStatus('The live feed is unavailable. Showing saved topics instead.', {
            id: 'feed-online',
            action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
          });
        } catch (offlineCause) {
          console.error('Unable to load the saved topic feed:', offlineCause);
          if (active) {
            notifyNativeStatus('The topic feed could not be loaded. Please retry.', {
              id: 'feed-online',
              action: { label: 'Retry', onClick: () => setFeedAttempt((value) => value + 1) },
            });
          }
        }
      }
    }

    const reconnect = () => void loadFeed();
    void loadFeed();
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', reconnect);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', reconnect);
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
        const localCatalogue = new OfflineCatalogue(databases.catalogue);
        let cacheDatabase = databases.catalogue;
        try {
          await openPrivateActivity();
          cacheDatabase = await openPrivateActivityDatabase(secureAuthStorage);
          clearNativeStatusNotice('private-cache-unavailable');
        } catch (cause) {
          // Keep public browsing and online reading available if secure storage
          // is unavailable. Note contents remain encrypted by NativeNoteCache.
          console.error('Encrypted offline cache is unavailable:', cause);
          notifyNativeStatus('Encrypted offline account storage is unavailable. Saved notes and activity may not be available offline.', {
            id: 'private-cache-unavailable',
          });
        }
        const localComments = new OfflineCommentCache(cacheDatabase);
        const localCounts = new OfflineTopicCountCache(cacheDatabase);
        const localNotes = new NativeNoteCache(cacheDatabase, secureAuthStorage);
        failure = 'Unable to open saved comments. Please try again.';
        await localComments.initialize();
        failure = 'Unable to open saved topic counts. Please try again.';
        await localCounts.initialize();
        failure = 'Unable to open saved notes. Please try again.';
        await localNotes.initialize();
        failure = 'Unable to open saved topics. Please try again.';
        const page = await localCatalogue.topics();
        if (active) {
          setError('');
          setFirstPage(page);
          setCatalogue(localCatalogue);
          setCommentCache(localComments);
          setCountCache(localCounts);
          setNoteCache(localNotes);
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
        if (active) setError(failure);
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
    const localCatalogue = catalogue;
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
          if (!feedPersonalized) {
            const page = await localCatalogue.topics();
            if (!active) return;
            setFirstPage(page);
          }
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
  }, [catalogueRefresh, catalogue, feedPersonalized]);

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
    async (cursor: CatalogueCursor | RecommendationCursor) => {
      if (!catalogue) throw new Error('The offline catalogue is not ready.');
      if ('categories' in cursor) {
        // Recommendation cursors are server-owned. If the connection drops or
        // the RPC fails, replace the feed with a fresh local catalogue page;
        // never append page one to the existing personalized feed.
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
          clearNativeStatusNotice('feed-pagination');
          return data as { topics: Topic[]; nextCursor: RecommendationCursor | null };
        } catch (cause) {
          console.error('Unable to continue personalized feed pagination:', cause);
          const page = await catalogue.topics();
          setFirstPage(page);
          setFeedPersonalized(false);
          notifyNativeStatus('Personalized recommendations are unavailable. Showing saved topics instead.', {
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
    [catalogue]
  );

  return (
    <ThemeProvider>
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
            <main className="native-content pt-16">
              {route?.kind === 'feed' && !error && !firstPage && (
                <NativeFeedSkeleton />
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
              {firstPage && !firstPage.topics.length && (
                <p className="px-6">No topics available.</p>
              )}
              {firstPage && firstPage.topics.length > 0 && (
                <div
                  className="h-[calc(100vh-4rem)] overflow-hidden"
                  hidden={route?.kind !== 'feed'}
                >
                  <TopicFeedCore
                    key={feedPersonalized ? 'personalized' : 'catalogue'}
                    topics={firstPage.topics}
                    nextCursor={firstPage.nextCursor}
                    personalized={feedPersonalized}
                    loadPage={loadPage}
                    userId={user?.id ?? null}
                    viewer={NativeViewer}
                    preservePositionOnUpdate
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
              {catalogue && commentCache && noteCache && route?.kind === 'topic' && (
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
            <NativeMfaGate userId={user?.id ?? null} />
            <OfflineIndicator activity={activity?.userId === user?.id ? activity : null} activityVersion={activityVersion} />
          </TopicNavigation.Provider>
        </NativeNotificationsProvider>
      </SignInPromptProvider>
    </ThemeProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<App />);
