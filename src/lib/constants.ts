import { SiteConfig, NavItem } from '@/types';

// ============================================
// Site Configuration
// ============================================

export const siteConfig: SiteConfig = {
  name: 'CathoScroll',
  description: 'Learn Catholic teaching one swipe at a time',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://joshuaargent.vercel.app',
  ogImage: '/web-app-manifest-512x512.png',
  links: {
    email: 'argentjackjoshua@gmail.com',
    github: 'https://github.com/joshuaargent',
    linkedin: 'https://linkedin.com/in/joshuaargent',
    youtube: 'https://youtube.com/@joshua_argent',
    instagram: 'https://instagram.com/joshua_argent',
    facebook: 'https://facebook.com/joshua_argent',
    tiktok: 'https://www.tiktok.com/@joshua_argent',
  },
  author: {
    name: 'Joshua Argent',
    bio: 'Founder of CathoScroll',
    location: 'Surrey, United Kingdom',
  },
};

// ============================================
// Navigation
// ============================================

export const mainNav: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Learn', href: '/learn' },
  { label: 'Search', href: '/search' },
  { label: 'Categories', href: '/categories' },
  { label: 'Bookmarks', href: '/bookmarks' },
];

export const footerNav = {
  main: [
    { label: 'Home', href: '/' },
    { label: 'Learn', href: '/learn' },
    { label: 'Search', href: '/search' },
    { label: 'Categories', href: '/categories' },
    { label: 'Bookmarks', href: '/bookmarks' },
    { label: 'About', href: '/about' },
    { label: 'FAQ', href: '/faq' },
  ],
  support: [
    { label: 'Contact', href: '/contact' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Cookie Policy', href: '/cookies' },
  ],
  social: [
    { label: 'GitHub', href: 'https://github.com/joshuaargent' },
    { label: 'LinkedIn', href: 'https://linkedin.com/in/joshuaargent' },
    { label: 'YouTube', href: 'https://youtube.com/@joshua_argent' },
    { label: 'Instagram', href: 'https://instagram.com/joshua_argent' },
    { label: 'Facebook', href: 'https://facebook.com/joshua_argent' },
    { label: 'TikTok', href: 'https://www.tiktok.com/@joshua_argent' },
  ],
};

// ============================================
// Meta
// ============================================

export const meta = {
  title: 'CathoScroll',
  description: 'Learn Catholic teaching one swipe at a time',
  github: 'https://github.com/joshuaargent',
  keywords: [
    'Catholic',
    'Catholicism',
    'Theology',
    'Scripture',
    'Apologetics',
    'Catechism',
    'Church History',
    'Prayer',
    'CathoScroll',
  ] as string[],
  instagramHandle: '@joshua_argent',
} as const;
