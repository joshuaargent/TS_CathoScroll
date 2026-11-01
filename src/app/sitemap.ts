import { MetadataRoute } from 'next';

import { categories } from '@/data/categories';
import { topics } from '@/data/topics';
import { siteConfig } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteConfig.url.replace(/\/+$/, '');
  const pageUrl = (path: string) => `${baseUrl}${path}`;

  const supabase = await createClient();
  const { data: profiles, error } = await supabase.from('profiles').select('username');

  if (error) {
    throw error;
  }

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: pageUrl('/'),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: pageUrl('/categories'),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: pageUrl('/about'),
      changeFrequency: 'monthly',
      priority: 0.65,
    },
    {
      url: pageUrl('/faq'),
      changeFrequency: 'monthly',
      priority: 0.65,
    },
    {
      url: pageUrl('/contact'),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: pageUrl('/privacy'),
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: pageUrl('/terms'),
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: pageUrl('/cookies'),
      changeFrequency: 'yearly',
      priority: 0.2,
    },
  ];

  const topicPages: MetadataRoute.Sitemap = topics.map((topic) => ({
    url: pageUrl(`/topic/${encodeURIComponent(topic.slug)}`),
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  const categoryPages: MetadataRoute.Sitemap = categories.map((category) => ({
    url: pageUrl(`/categories/${encodeURIComponent(category.slug)}`),
    changeFrequency: 'monthly',
    priority: 0.85,
  }));

  const profilePages: MetadataRoute.Sitemap = (profiles ?? [])
    .filter((profile) => profile.username)
    .map((profile) => ({
      url: pageUrl(`/profile/${encodeURIComponent(profile.username)}`),
      changeFrequency: 'weekly',
      priority: 0.3,
    }));

  return [...staticPages, ...categoryPages, ...topicPages, ...profilePages];
}
