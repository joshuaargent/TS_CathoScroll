import type { Metadata } from 'next';

import { siteConfig } from '@/lib/constants';

interface PageMetadataOptions {
  title: string;
  description: string;
  path: string;
}

export function createPageMetadata({
  title,
  description,
  path,
}: PageMetadataOptions): Metadata {
  const url = new URL(path, siteConfig.url).toString();
  const socialTitle = `${title} | ${siteConfig.name}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'website',
      locale: 'en_GB',
      url,
      siteName: siteConfig.name,
      title: socialTitle,
      description,
      images: [
        {
          url: siteConfig.ogImage,
          width: 512,
          height: 512,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: socialTitle,
      description,
      images: [siteConfig.ogImage],
    },
  };
}
