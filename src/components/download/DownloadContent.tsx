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
  digest?: string | null;
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
    description: 'Install CathoScroll directly on your Android device.',
    formats: 'APK',
    extensions: ['.apk'],
    icon: Smartphone,
  },
  {
    name: 'Windows',
    description: 'Download the CathoScroll desktop application for Windows.',
    formats: 'EXE',
    extensions: ['.exe'],
    icon: Monitor,
  },
  {
    name: 'Linux',
    description: 'Choose the Linux package that suits your distribution and installation preference.',
    formats: 'AppImage (recommended) or DEB',
    extensions: ['.appimage', '.deb'],
    icon: Terminal,
  },
  {
    name: 'macOS',
    description: 'Download the CathoScroll desktop application for Mac.',
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

function getAssetLabel(asset: GitHubReleaseAsset, platformName: string): string {
  const fileName = asset.name.toLowerCase();

  if (platformName === 'Linux') {
    if (fileName.endsWith('.appimage')) return 'Download AppImage';
    if (fileName.endsWith('.deb')) return 'Download DEB package';
  }

  if (platformName === 'macOS') {
    if (fileName.endsWith('.dmg')) return 'Download DMG';
    if (fileName.endsWith('.zip')) return 'Download ZIP';
  }

  return 'Download';
}

function getPlatformAssets(
  assets: GitHubReleaseAsset[],
  extensions: string[]
): GitHubReleaseAsset[] {
  return assets.filter((asset) => {
    const fileName = asset.name.toLowerCase();

    return extensions.some((extension) => fileName.endsWith(extension));
  });
}

export default function DownloadContent({
  release,
}: DownloadContentProps) {
  const version = release?.tag_name ?? 'Unavailable';

  const releasesUrl =
    release?.html_url ??
    'https://github.com/joshuaargent/TS_CathoScroll/releases';

  return (
    <main className="container py-12">
      <div className="mt-12 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">
          Download CathoScroll
        </h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Take CathoScroll with you. Download the application for
          your device and explore Catholic teaching wherever you are.
        </p>

        <div className="mt-6">
          <Badge variant="accent" size="sm">
            Latest version: {version}
          </Badge>
        </div>
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
            <div className="border-border mb-6 rounded-2xl border p-8">
              <Badge variant="default" size="sm">
                Release unavailable
              </Badge>

              <h3 className="mt-4 text-2xl font-bold">
                Unable to retrieve the latest release
              </h3>

              <p className="text-text-secondary mt-4 leading-relaxed">
                GitHub release information could not be retrieved.
                Download availability cannot currently be verified.
                Please try again later or view the releases directly
                on GitHub.
              </p>

              <div className="mt-6">
                <Button asChild variant="outline">
                  <a
                    href={releasesUrl}
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
                ? getPlatformAssets(release.assets, platform.extensions)
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
                      variant={available ? 'accent' : 'default'}
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
                    {platform.name === 'Linux' && available && (
                  <p className="text-text-secondary mt-2 text-xs leading-relaxed">
                    AppImage runs without a traditional installation and is
                    the easiest option for most Linux users. DEB is intended
                    for Debian, Ubuntu, and compatible distributions.
                  </p>
                    )}
                    {available ? (
                      platformAssets.map((asset) => (
                        <Button
                          key={asset.name}
                          asChild
                          size="md"
                          className="w-full justify-between"
                          style={{ color: '#ffffff' }}
                        >
                          <a
                            href={asset.browser_download_url}
                            aria-label={`Download ${asset.name} for ${platform.name}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Download size={17} className="shrink-0" />
                              <span className="truncate">{getAssetLabel(asset, platform.name)}</span>
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
                        {!release ? 'Unavailable' : 'Coming Soon'}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {release?.body && (
          <section>
            <h2 className="mb-6 text-3xl font-bold">
              Release Notes
            </h2>

            <div className="border-border rounded-2xl border p-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-bold">
                  CathoScroll {version}
                </h3>

                {release.published_at && (
                  <Badge variant="default" size="sm">
                    {new Date(release.published_at).toLocaleDateString(
                      'en-GB',
                      {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      }
                    )}
                  </Badge>
                )}
              </div>

              <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">
                {release.body}
              </p>

              <div className="mt-6">
                <Button asChild variant="outline">
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Full Release Details
                    <ExternalLink size={16} />
                  </a>
                </Button>
              </div>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-6 text-3xl font-bold">
            About the Downloads
          </h2>

          <div className="border-border rounded-2xl border p-8">
            <p className="text-text-secondary leading-relaxed">
              CathoScroll release builds target Android, Windows, Linux, and
              macOS. Available downloads are detected automatically from
              the latest published GitHub release.
            </p>

            <p className="text-text-secondary mt-4 leading-relaxed">
              Windows checks for updates when launched, downloads them in
              the background, and installs them after the app is closed.
              Linux AppImage updates install after the app is closed; DEB
              updates require system authentication when the installer runs.
              macOS checks for a newer release on
              launch and displays an update notice with a link to the
              download page; macOS updates are installed manually. Android
              checks GitHub Releases on launch, prompts when a newer signed
              APK is available, downloads it, and opens Android's installer.
              Android requires the user to approve the installation and may
              require allowing installs from CathoScroll in system settings.
              The first production-signed Android release cannot install
              over an older debug-signed build. If you already have a
              debug-signed version installed, connect to the internet and
              allow pending account activity to sync before uninstalling it;
              uninstalling removes device-only data. Install this APK after
              removing the old build. Future production-signed releases can
              then update normally. Keep your Android release keystore and
              passwords backed up securely; every future APK must use the
              same signing key. macOS builds are unsigned, so Gatekeeper may require you to
              Control-click the app and choose Open on its first launch.
              Only install downloads obtained from this official CathoScroll
              website.
            </p>

            <div className="mt-6">
              <Button asChild variant="outline">
                <a
                  href={releasesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View All GitHub Releases
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
              <Button size="lg" style={{ color: '#ffffff' }}>
                Contact Us
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
