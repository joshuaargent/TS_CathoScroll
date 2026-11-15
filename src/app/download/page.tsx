
import type { Metadata } from 'next';

import DownloadContent, {
  type GitHubRelease,
} from '@/components/download/DownloadContent';
import { siteConfig } from '@/lib/constants';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Download CathoScroll for Android, Windows, Linux and macOS.',
  alternates: {
    canonical: new URL('/download', siteConfig.url).toString(),
  },
  openGraph: {
    title: 'Download CathoScroll',
    description:
      'Download CathoScroll across mobile and desktop platforms.',
    url: new URL('/download', siteConfig.url).toString(),
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

  return (
    <main>
      <DownloadContent release={release} />
    </main>
  );
}
