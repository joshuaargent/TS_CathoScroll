'use client';

import { useEffect, useState } from 'react';

import { shuffle } from '@/lib/utils';

import { Topic } from '@/types';

import { TopicViewer } from './TopicViewer';

interface TopicFeedProps {
  topics: Topic[];
  personalized?: boolean;
}

export function TopicFeed({ topics, personalized = false }: TopicFeedProps) {
  const [feedTopics, setFeedTopics] = useState<Topic[]>(topics);

  const [topicIndex, setTopicIndex] = useState(personalized ? 0 : Math.floor(topics.length / 2));

  // ----------------------------------
  // Initial Feed
  // ----------------------------------

  useEffect(() => {
    // Signed-out users get the existing shuffled feed; personalized server
    // ranking is preserved for signed-in users and starts at its top result.
    const shuffled = personalized ? topics : shuffle(topics);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedTopics(shuffled);

    setTopicIndex(personalized ? 0 : Math.floor(shuffled.length / 2));
  }, [topics, personalized]);

  // ----------------------------------
  // Navigation
  // ----------------------------------

  // Modulo arithmetic wraps the finite catalogue into a circular feed.
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
