// ============================================
// Core Types for CathoScroll
// ============================================

// ----- Site Configuration -----
export interface SiteConfig {
  name: string;
  description: string;
  url: string;
  ogImage: string;
  links: {
    email: string;
    github: string;
    linkedin: string;
    youtube: string;
    instagram: string;
    facebook: string;
    tiktok: string;
  };
  author: {
    name: string;
    bio: string;
    location: string;
  };
}

// ----- Navigation -----
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  children?: NavItem[];
}

// ----- Topic Types -----
export interface Topic {
  id: string;
  slug: string;

  // The display name is resolved from the topic's database category relation.
  category: string;

  question: string;

  answer: string;

  explanation: string;

  catechism: {
    paragraphs: string[];
    text: string;
  };

  scripture: {
    reference: string;
    text: string;
  };
}

export interface ContentCategory {
  slug: string;
  name: string;
  description: string;
  orderIndex: number;
  topicCount?: number;
}

export interface TopicSlide {
  type: 'question' | 'answer' | 'explanation' | 'catechism' | 'scripture';

  title: string;

  content: string;

  reference?: string;
}

// ----- Form Types -----
export interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}
