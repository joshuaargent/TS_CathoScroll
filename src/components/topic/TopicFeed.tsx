'use client';

import { useEffect, useState } from 'react';

import { shuffle } from '@/lib/utils';

import { Topic } from '@/types';

import { TopicViewer } from './TopicViewer';

interface TopicFeedProps {
  topics: Topic[];
}

export function TopicFeed({ topics }: TopicFeedProps) {
  const [feedTopics, setFeedTopics] = useState<Topic[]>(topics);

  const [topicIndex, setTopicIndex] = useState(Math.floor(topics.length / 2));

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    const shuffled = shuffle(topics);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedTopics(shuffled);

    setTopicIndex(Math.floor(shuffled.length / 2));
  }, [topics]);

  // ----------------------------------
  // Navigation
  // ----------------------------------

  const nextTopic = () => {
    setTopicIndex((prev) => (prev + 1) % feedTopics.length);
  };

  const previousTopic = () => {
    setTopicIndex((prev) => (prev - 1 + feedTopics.length) % feedTopics.length);
  };

  // ----------------------------------
  // Loading
  // ----------------------------------

  if (!feedTopics.length) {
    return null;
  }

  return (
    <div className="h-full">
      <TopicViewer
        topics={feedTopics}
        topicIndex={topicIndex}
        onNextTopic={nextTopic}
        onPreviousTopic={previousTopic}
      />
    </div>
  );
}
