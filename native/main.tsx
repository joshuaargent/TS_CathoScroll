import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommentSection } from '@/components/comments/CommentSection';
import { TopicFeedCore } from '@/components/topic/TopicFeedCore';
import { TopicSwipeViewer } from '@/components/topic/TopicSwipeViewer';
import { TopicArticle, TopicArticleHeader } from '@/components/topic/TopicArticle';
import { SignInPromptProvider } from '@/components/providers/SignInPromptProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { OfflineCatalogue, type CatalogueCursor } from '@/lib/offline/catalogue';
import { OfflineCommentCache } from '@/lib/offline/comment-cache';
import { OfflineTopicCountCache, type CachedTopicCounts } from '@/lib/offline/topic-count-cache';
import { loadTopicActivity } from '@/lib/topic-activity';
import { createClient } from '@/lib/supabase/client';
import type { RecommendationCursor } from '@/lib/recommendations';
import { openNativeDatabases } from '@/lib/offline/native-database';
import type { Topic } from '@/types';
import './style.css';

type CataloguePage = { topics: Topic[]; nextCursor: CatalogueCursor | null };
const TopicNavigation = createContext<{
  selected: Topic | null;
  open: (topic: Topic) => void;
  counts: OfflineTopicCountCache | null;
} | null>(null);

function NativeViewer(props: {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
}) {
  const [message, setMessage] = useState('');
  const [countError, setCountError] = useState('');
  const [counts, setCounts] = useState<{
    topicId: string;
    value: CachedTopicCounts;
    fresh: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const navigation = useContext(TopicNavigation);
  if (!navigation?.counts) throw new Error('Native topic navigation is unavailable.');
  const topicId = String(props.topics[props.topicIndex].id);
  const countCache = navigation.counts;

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
  }, [countCache, topicId, refresh]);

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
  return (
    <div className="flex h-full flex-col">
      {currentCounts && !currentCounts.fresh && (
        <p role="status" className="text-text-secondary px-6 text-xs">
          Counts saved {new Date(currentCounts.value.savedAt).toLocaleString()}; they may have
          changed.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <TopicSwipeViewer
          {...props}
          active={!navigation.selected}
          userId={null}
          currentActivity={
            currentCounts
              ? {
                  topicId,
                  userId: null,
                  likes: currentCounts.value.likes,
                  comments: currentCounts.value.comments,
                  liked: false,
                  bookmarked: false,
                  completed: false,
                }
              : null
          }
          currentActivityError={false}
          actionError={[message, countError].filter(Boolean).join(' ')}
          pendingActions={new Set()}
          retryActivity={() => setMessage('')}
          onLike={() => setMessage('Account activity is not available in this preview yet.')}
          onDoubleTapLike={() =>
            setMessage('Account activity is not available in this preview yet.')
          }
          onBookmark={() => setMessage('Account activity is not available in this preview yet.')}
          onComments={() => navigation.open(props.topics[props.topicIndex])}
          onShare={() => setMessage('Sharing is not available in this preview yet.')}
          onComplete={() => {}}
        />
      </div>
    </div>
  );
}

function App() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogue | null>(null);
  const [firstPage, setFirstPage] = useState<CataloguePage | null>(null);
  const [commentCache, setCommentCache] = useState<OfflineCommentCache | null>(null);
  const [countCache, setCountCache] = useState<OfflineTopicCountCache | null>(null);
  const [selected, setSelected] = useState<Topic | null>(null);
  const [error, setError] = useState('');
  const [navigationMessage, setNavigationMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const databases = await openNativeDatabases();
        const localCatalogue = new OfflineCatalogue(databases.catalogue);
        const localComments = new OfflineCommentCache(databases.activity);
        const localCounts = new OfflineTopicCountCache(databases.activity);
        await localComments.initialize();
        await localCounts.initialize();
        const page = await localCatalogue.topics();
        if (active) {
          setFirstPage(page);
          setCatalogue(localCatalogue);
          setCommentCache(localComments);
          setCountCache(localCounts);
        }
      } catch (cause) {
        console.error('Unable to open the offline catalogue:', cause);
        if (active) setError('Unable to open the offline catalogue. Please restart the app.');
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function unavailable() {
      setNavigationMessage('This page is not available in the offline preview yet.');
    }
    window.addEventListener('cathoscroll:navigate', unavailable);
    return () => window.removeEventListener('cathoscroll:navigate', unavailable);
  }, []);

  useEffect(() => {
    if (selected) document.getElementById('comments')?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [selected]);

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
        <TopicNavigation.Provider value={{ selected, open: setSelected, counts: countCache }}>
          <header className="fixed top-0 right-0 left-0 z-[50]">
            <nav className="container">
              <div className="flex h-16 items-center justify-between">
                <span className="text-text-primary text-xl font-semibold">CathoScroll</span>
                <span className="text-text-secondary text-sm">Offline preview</span>
              </div>
            </nav>
          </header>
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
              <div className="h-[calc(100vh-4rem)] overflow-hidden" hidden={Boolean(selected)}>
                <TopicFeedCore
                  topics={firstPage.topics}
                  nextCursor={firstPage.nextCursor}
                  personalized={false}
                  loadPage={loadPage}
                  userId={null}
                  viewer={NativeViewer}
                />
              </div>
            )}
            {selected && commentCache && (
              <div className="container py-12">
                <button type="button" className="text-accent" onClick={() => setSelected(null)}>
                  ← Explore Feed
                </button>
                <TopicArticleHeader topic={selected} />
                <p className="text-text-secondary">
                  Account features are not available in this preview yet.
                </p>
                <TopicArticle topic={selected} />
                <CommentSection topicId={String(selected.id)} cache={commentCache} />
              </div>
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
