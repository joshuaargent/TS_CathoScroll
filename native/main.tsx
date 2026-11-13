import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TopicFeedCore } from '@/components/topic/TopicFeedCore';
import { TopicSwipeViewer } from '@/components/topic/TopicSwipeViewer';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { OfflineCatalogue, type CatalogueCursor } from '@/lib/offline/catalogue';
import type { RecommendationCursor } from '@/lib/recommendations';
import { openNativeDatabases } from '@/lib/offline/native-database';
import type { Topic } from '@/types';
import './style.css';

type CataloguePage = { topics: Topic[]; nextCursor: CatalogueCursor | null };

function NativeViewer(props: {
  topics: Topic[];
  topicIndex: number;
  initialUserId: string | null;
  onNextTopic: () => void;
  onPreviousTopic: () => void;
}) {
  const [message, setMessage] = useState('');
  return (
    <TopicSwipeViewer
      {...props}
      userId={null}
      currentActivity={null}
      currentActivityError={false}
      actionError={message}
      pendingActions={new Set()}
      retryActivity={() => setMessage('')}
      onLike={() => setMessage('Account activity is not available in this preview yet.')}
      onDoubleTapLike={() => setMessage('Account activity is not available in this preview yet.')}
      onBookmark={() => setMessage('Account activity is not available in this preview yet.')}
      onComments={() =>
        setMessage(
          'Comments require an internet connection and are not available in this preview yet.'
        )
      }
      onShare={() => setMessage('Sharing is not available in this preview yet.')}
      onComplete={() => {}}
    />
  );
}

function App() {
  const [catalogue, setCatalogue] = useState<OfflineCatalogue | null>(null);
  const [firstPage, setFirstPage] = useState<CataloguePage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const databases = await openNativeDatabases();
        const localCatalogue = new OfflineCatalogue(databases.catalogue);
        const page = await localCatalogue.topics();
        if (active) {
          setFirstPage(page);
          setCatalogue(localCatalogue);
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
      <header className="fixed top-0 right-0 left-0 z-[50]">
        <nav className="container">
          <div className="flex h-16 items-center justify-between">
            <span className="text-text-primary text-xl font-semibold">CathoScroll</span>
            <span className="text-text-secondary text-sm">Offline preview</span>
          </div>
        </nav>
      </header>
      <main className="pt-16">
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
          <div className="h-[calc(100vh-4rem)] overflow-hidden">
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
      </main>
    </ThemeProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<App />);
