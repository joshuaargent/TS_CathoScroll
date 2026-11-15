
import Link from 'next/link';
import {
  Apple,
  Download,
  ExternalLink,
  Monitor,
  Smartphone,
  Terminal,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  body: string | null;
  assets: GitHubReleaseAsset[];
  prerelease: boolean;
  draft: boolean;
}

interface DownloadContentProps {
  release: GitHubRelease | null;
}

const platforms = [
  {
    name: 'Android',
    description:
      'Install CathoScroll directly on your Android device.',
    formats: 'APK',
    extensions: ['.apk'],
    icon: Smartphone,
  },
  {
    name: 'Windows',
    description:
      'Download the CathoScroll desktop application for Windows.',
    formats: 'EXE or MSI',
    extensions: ['.exe', '.msi'],
    icon: Monitor,
  },
  {
    name: 'Linux',
    description:
      'Download the CathoScroll desktop application for Linux.',
    formats: 'AppImage, DEB or RPM',
    extensions: ['.appimage', '.deb', '.rpm'],
    icon: Terminal,
  },
  {
    name: 'macOS',
    description:
      'Download the CathoScroll desktop application for Mac.',
    formats: 'DMG or ZIP',
    extensions: ['.dmg', '.zip'],
    icon: Apple,
  },
];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function getPlatformAssets(
  assets: GitHubReleaseAsset[],
  extensions: string[]
): GitHubReleaseAsset[] {
  return assets.filter((asset) => {
    const fileName = asset.name.toLowerCase();

    return extensions.some((extension) =>
      fileName.endsWith(extension)
    );
  });
}

export default function DownloadContent({
  release,
}: DownloadContentProps) {
  const version = release?.tag_name ?? null;

  const releasesUrl =
    release?.html_url ??
    'https://github.com/joshuaargent/TS_CathoScroll/releases';

  return (
    <div className="container py-12">
      <div className="mt-12 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">
          Download CathoScroll
        </h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Take CathoScroll with you. Download the application for
          your device and explore Catholic teaching wherever you are.
        </p>

        {release && (
          <div className="mt-6">
            <Badge variant="accent" size="sm">
              Latest version: {version}
            </Badge>
          </div>
        )}
      </div>

      <div className="space-y-16">
        <section>
          <h2 className="mb-6 text-3xl font-bold">
            Choose Your Platform
          </h2>

          <p className="text-text-secondary mb-6 leading-relaxed">
            Choose the version that matches your device. Available
            installers are detected automatically from the latest
            published GitHub release.
          </p>

          {!release && (
            <div className="border-border mb-6 rounded-2xl border p-6">
              <Badge variant="default" size="sm">
                Release information unavailable
              </Badge>

              <h3 className="mt-4 text-xl font-bold">
                Unable to retrieve the latest release
              </h3>

              <p className="text-text-secondary mt-3 leading-relaxed">
                The GitHub release information could not be retrieved.
                Platform availability cannot currently be verified.
                Please try again later or view the releases directly
                on GitHub.
              </p>

              <div className="mt-6">
                <Button asChild variant="outline">
                  <a
                    href="https://github.com/joshuaargent/TS_CathoScroll/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View GitHub Releases
                    <ExternalLink size={16} />
                  </a>
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {platforms.map((platform) => {
              const Icon = platform.icon;

              const platformAssets = release
                ? getPlatformAssets(
                    release.assets,
                    platform.extensions
                  )
                : [];

              const available = platformAssets.length > 0;

              return (
                <article
                  key={platform.name}
                  className={`border-border flex h-full flex-col rounded-2xl border p-6 ${
                    available ? '' : 'opacity-60'
                  }`}
                >
                  <div className="mb-5 flex items-center justify-between gap-2">
                    <div className="bg-accent-light text-accent flex h-12 w-12 items-center justify-center rounded-xl">
                      <Icon size={24} />
                    </div>

                    <Badge
                      variant={
                        available ? 'accent' : 'default'
                      }
                      size="sm"
                    >
                      {!release
                        ? 'Unknown'
                        : available
                          ? 'Available'
                          : 'Coming Soon'}
                    </Badge>
                  </div>

                  <h3 className="text-2xl font-bold">
                    {platform.name}
                  </h3>

                  <p className="text-text-secondary mt-3 leading-relaxed">
                    {platform.description}
                  </p>

                  <p className="text-text-secondary mt-4 text-sm">
                    Formats: {platform.formats}
                  </p>

                  <div className="mt-auto space-y-3 pt-6">
                    {available ? (
                      platformAssets.map((asset) => (
                        <Button
                          key={asset.name}
                          asChild
                          size="md"
                          className="w-full justify-between"
                        >
                          <a href={asset.browser_download_url}>
                            <span className="flex min-w-0 items-center gap-2">
                              <Download
                                size={17}
                                className="shrink-0"
                              />

                              <span className="truncate">
                                {asset.name}
                              </span>
                            </span>

                            <span className="shrink-0 text-xs opacity-80">
                              {formatFileSize(asset.size)}
                            </span>
                          </a>
                        </Button>
                      ))
                    ) : (
                      <Button
                        disabled
                        size="md"
                        className="w-full"
                        leftIcon={<Download size={17} />}
                      >
                        {!release
                          ? 'Unavailable'
                          : 'Not available yet'}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">
            About the Downloads
          </h2>

          <div className="border-border rounded-2xl border p-8">
            <p className="text-text-secondary leading-relaxed">
              CathoScroll is available across mobile and desktop
              platforms. Android and Windows installers are currently
              published, with Linux and macOS versions planned.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              Download availability is determined by the files
              published in the latest GitHub release. New installers
              will automatically appear here when published.
            </p>

            <div className="mt-6">
              <Button asChild variant="outline">
                <a
                  href={releasesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View GitHub Release
                  <ExternalLink size={16} />
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-3xl font-bold">
            Need Help?
          </h2>

          <p className="text-text-secondary leading-relaxed">
            If you experience problems downloading or installing
            CathoScroll, get in touch.
          </p>

          <div className="mt-6">
            <Link href="/contact">
              <Button
                size="lg"
                style={{ color: '#ffffff' }}
              >
                Contact Us
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
