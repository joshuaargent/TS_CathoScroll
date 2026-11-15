
import type { Metadata } from 'next';

import DownloadContent from "@/components/download/DownloadContent"
import { siteConfig } from '@/lib/constants';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Download CathoScroll for Android, Windows, Linux and macOS. Learn about Catholic teaching online or offline.',
  alternates: {
    canonical: new URL('/download', siteConfig.url).toString(),
  },
  openGraph: {
    title: 'Download CathoScroll',
    description:
      'Take your Catholic learning further with CathoScroll for mobile and desktop.',
    url: new URL('/download', siteConfig.url).toString(),
  },
};

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  body: string | null;
  assets: GitHubReleaseAsset[];
  prerelease: boolean;
  draft: boolean;
}

async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      'https://api.github.com/repos/joshuaargent/TS_CathoScroll/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
        next: {
          revalidate: 300,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const release = (await response.json()) as GitHubRelease;

    if (
      release.draft ||
      release.prerelease ||
      !Array.isArray(release.assets)
    ) {
      return null;
    }

    return release;
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const release = await getLatestRelease();

  return (
    <main>
      <DownloadContent release={release} />
    </main>
  );
}
