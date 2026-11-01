import { Topic, TopicSlide } from '@/types';

export function getTopicSlides(
  topic: Topic
): TopicSlide[] {
  return [
    {
      type: 'question',
      title: 'Question',
      content: topic.question,
    },

    {
      type: 'answer',
      title: 'Short Answer',
      content: topic.answer,
    },

    {
      type: 'explanation',
      title: 'Explanation',
      content: topic.explanation,
    },

    {
      type: 'catechism',
      title: 'Catechism',
      content: topic.catechism.text,
      reference: `CCC ${topic.catechism.paragraphs.join(', ')}`,
    },

    {
      type: 'scripture',
      title: topic.scripture.reference,
      content: topic.scripture.text,
    },
  ];
}