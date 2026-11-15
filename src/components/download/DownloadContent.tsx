import Link from 'next/link';
import { Apple, Download, ExternalLink, Monitor, Smartphone, Terminal } from 'lucide-react';

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type Release = {
  name?: string | null;
  tag_name?: string | null;
  html_url?: string | null;
  published_at?: string | null;
  assets?: ReleaseAsset[] | null;
};

type DownloadContentProps = {
  release: Release | null;
};

const platforms = [
  {
    name: 'Android',
    description: 'Install CathoScroll directly on your Android device.',
    extensions: ['.apk'],
    icon: Smartphone,
    formats: 'APK',
  },
  {
    name: 'Windows',
    description: 'The desktop application for Windows.',
    extensions: ['.exe', '.msi'],
    icon: Monitor,
    formats: 'EXE or MSI',
  },
  {
    name: 'Linux',
    description: 'The desktop application for Linux distributions.',
    extensions: ['.appimage', '.deb', '.rpm'],
    icon: Terminal,
    formats: 'AppImage, DEB or RPM',
  },
  {
    name: 'macOS',
    description: 'The desktop application for Mac.',
    extensions: ['.dmg', '.zip'],
    icon: Apple,
    formats: 'DMG or ZIP',
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

function getPlatformAssets(assets: ReleaseAsset[], extensions: string[]): ReleaseAsset[] {
  return assets.filter((asset) => {
    const fileName = asset.name.toLowerCase();

    return extensions.some((extension) => fileName.endsWith(extension));
  });
}

export default function DownloadContent({ release }: DownloadContentProps) {
  const assets = release?.assets ?? [];
  const version = release?.tag_name ?? release?.name ?? 'Latest release';

  const releasesUrl =
    release?.html_url ?? 'https://github.com/joshuaargent/TS_CathoScroll/releases';

  return (
    <main className="container py-12">
      <section className="mx-auto max-w-5xl">
        <header className="mb-12 text-center">
          <span className="bg-accent/10 text-accent mb-4 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium">
            CathoScroll downloads
          </span>

          <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Download CathoScroll
          </h1>

          <p className="text-text-secondary mx-auto max-w-2xl text-lg">
            Access Catholic content, discussions and resources across your devices.
          </p>

          <p className="text-text-secondary mt-4 text-sm">
            Latest version: <span className="font-semibold">{version}</span>
          </p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {platforms.map((platform) => {
            const Icon = platform.icon;

            const platformAssets = getPlatformAssets(assets, platform.extensions);

            const available = platformAssets.length > 0;

            return (
              <article
                key={platform.name}
                className={`border-border flex flex-col rounded-2xl border p-6 ${
                  available ? 'bg-background' : 'bg-background opacity-60'
                }`}
              >
                <div className="mb-5 flex items-start justify-between gap-2">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                      available ? 'bg-accent/10 text-accent' : 'bg-accent/10 text-text-secondary'
                    }`}
                  >
                    <Icon size={24} />
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      available ? 'bg-accent/10 text-accent' : 'bg-accent/10 text-text-secondary'
                    }`}
                  >
                    {available ? 'Available' : 'Coming soon'}
                  </span>
                </div>

                <h2 className="mb-2 text-xl font-semibold">{platform.name}</h2>

                <p className="text-text-secondary mb-5 min-h-12 text-sm leading-relaxed">
                  {platform.description}
                </p>

                <p className="text-text-secondary mb-5 text-xs">Formats: {platform.formats}</p>

                <div className="mt-auto space-y-3">
                  {available ? (
                    platformAssets.map((asset) => (
                      <a
                        key={asset.name}
                        href={asset.browser_download_url}
                        className="bg-accent flex w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Download size={17} className="shrink-0" />

                          <span className="truncate">{asset.name}</span>
                        </span>

                        <span className="shrink-0 text-xs opacity-80">
                          {formatFileSize(asset.size)}
                        </span>
                      </a>
                    ))
                  ) : (
                    <div
                      aria-disabled="true"
                      className="border-border text-text-secondary flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium"
                    >
                      <Download size={17} />
                      Not available yet
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <section className="border-border mt-10 rounded-2xl border p-6">
          <div className="flex items-start gap-4">
            <div className="bg-accent/10 text-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <Monitor size={21} />
            </div>

            <div>
              <h2 className="mb-2 text-lg font-semibold">About the downloads</h2>

              <p className="text-text-secondary mb-4 text-sm leading-relaxed">
                CathoScroll is being made available across mobile and desktop platforms. Desktop
                downloads will appear here as their installers are published. Available versions are
                detected automatically from the latest GitHub release.
              </p>

              <a
                href={releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent inline-flex items-center gap-2 text-sm font-medium hover:underline"
              >
                View all GitHub releases
                <ExternalLink size={15} />
              </a>
            </div>
          </div>
        </section>

        <div className="text-text-secondary mt-8 text-center text-sm">
          Need help? Visit the{' '}
          <Link href="/contact" className="text-accent font-medium hover:underline">
            contact page
          </Link>
          .
        </div>
      </section>
    </main>
  );
}
