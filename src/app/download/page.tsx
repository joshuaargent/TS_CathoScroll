import type { Metadata } from 'next';

import DownloadContent, {
  type GitHubRelease,
} from '@/components/download/DownloadContent';
import { siteConfig } from '@/lib/constants';

export const revalidate = 300;

const downloadPageUrl = new URL('/download', siteConfig.url).toString();

export const metadata: Metadata = {
  title: {
    absolute: 'Download CathoScroll for Android, Windows, Mac & Linux',
  },
  description:
    'Get the official CathoScroll app for Android, Windows, macOS and Linux. Download the latest release, compare installers and follow platform-specific setup guidance.',
  alternates: {
    canonical: downloadPageUrl,
  },
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: downloadPageUrl,
    siteName: siteConfig.name,
    title: 'Download CathoScroll for Android, Windows, Mac & Linux',
    description:
      'Get the official CathoScroll app for Android, Windows, macOS and Linux. Download the latest release and find installation guidance for your device.',
    images: [
      {
        url: siteConfig.ogImage,
        width: 512,
        height: 512,
        alt: 'CathoScroll app',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Download CathoScroll for Android, Windows, Mac & Linux',
    description:
      'Get the official CathoScroll app for Android, Windows, macOS and Linux.',
    images: [siteConfig.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

async function getLatestRelease(): Promise<GitHubRelease> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CathoScroll-Website',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    'https://api.github.com/repos/joshuaargent/TS_CathoScroll/releases/latest',
    {
      headers,
      next: {
        revalidate: 300,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    );
  }

  const release: GitHubRelease = await response.json();

  if (
    !release.tag_name ||
    !release.html_url ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('GitHub returned an invalid or incomplete release.');
  }

  return release;
}

export default async function DownloadPage() {
  let release: GitHubRelease | null = null;

  try {
    release = await getLatestRelease();
  } catch (error) {
    console.error('[Download Page] Failed to retrieve latest release:', error);
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CathoScroll',
    applicationCategory: 'EducationalApplication',
    operatingSystem: ['Android', 'Windows', 'macOS', 'Linux'],
    url: downloadPageUrl,
    description:
      'An educational app for exploring Catholic teaching, Scripture, theology and Church history.',
    ...(release?.tag_name ? { softwareVersion: release.tag_name } : {}),
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'GBP',
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
        }}
      />
      <DownloadContent release={release} />
    </main>
  );
}
