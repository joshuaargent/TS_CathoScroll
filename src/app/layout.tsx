import type { Metadata, Viewport } from 'next';
import { inter, lora, jetbrainsMono } from '@/lib/fonts';
import { siteConfig, meta } from '@/lib/constants';
import { Navbar } from '@/components/layout/Navbar';
import { ConditionalFooter } from '@/components/layout/ConditionalFooter';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

// ============================================
// Metadata
// ============================================

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAFAF9',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  manifest: '/manifest.json',
  title: {
    default: meta.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: meta.description,
  keywords: meta.keywords,
  authors: [{ name: siteConfig.author.name }],
  creator: siteConfig.author.name,
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'CathoScroll',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: meta.title,
    description: meta.description,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
    images: [siteConfig.ogImage],
    creator: meta.instagramHandle,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    types: {
      'application/rss+xml': `${siteConfig.url}/feed.xml`,
    },
  },
};

// ============================================
// Root Layout
// ============================================

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${lora.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#FAFAF9" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0C0A09" media="(prefers-color-scheme: dark)" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storedTheme = localStorage.getItem('theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var root = document.documentElement;
                  if (storedTheme === 'dark' || (!storedTheme && prefersDark)) {
                    root.classList.add('dark');
                    var themeColorMeta = document.querySelector('meta[name="theme-color"]');
                    if (themeColorMeta) {
                      themeColorMeta.setAttribute('content', '#0C0A09');
                    }
                  } else {
                    var themeColorMeta = document.querySelector('meta[name="theme-color"]');
                    if (themeColorMeta) {
                      themeColorMeta.setAttribute('content', '#FAFAF9');
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <ThemeProvider>
          <AuthProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <ConditionalFooter />
            <Analytics />
            <SpeedInsights />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
