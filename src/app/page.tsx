import { TopicFeed } from '@/components/topic/TopicFeed';
import { topics } from '@/data/topics';

export default function HomePage() {
  return (
    <div
      className="
        h-[calc(100vh-4rem)]
        overflow-hidden
      "
    >
      <TopicFeed topics={topics} />
    </div>
  );
}