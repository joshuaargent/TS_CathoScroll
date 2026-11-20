import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';
import { AnalyticsConsentSettingsButton } from '@/components/privacy/AnalyticsConsentManager';

export const metadata = createPageMetadata({
  title: "Cookies",
  description: "How CathoScroll uses cookies and similar technologies.",
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Cookie Policy</h1>

        <p className="text-text-secondary mt-4 text-lg">Last updated: 20 November 2026</p>
      </div>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 text-3xl font-bold">What Are Cookies?</h2>

          <p className="text-text-secondary leading-relaxed">
            Cookies are small text files placed on your device when you visit a website. They help
            websites function correctly, remember preferences, maintain secure sessions, and
            understand how services are being used.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How CathoScroll Uses Cookies and Similar Technologies</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses cookies and similar technologies for core functionality, authentication,
            security, essential preferences, and offline support. We offer optional first-party site and server-side product analytics as described below. They are off by default and are not used for cross-site advertising or to build sponsor targeting profiles.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Essential Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            Essential cookies are required for CathoScroll to function correctly.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">These cookies may be used for:</p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Account authentication and login sessions.</li>
            <li>User security and fraud prevention.</li>
            <li>Remembering preferences and settings.</li>
            <li>Protecting platform functionality.</li>
            <li>Operating core site features.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Without essential cookies, certain features of CathoScroll may not function properly.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Analytics and Performance Measurement</h2>

          <p className="text-text-secondary leading-relaxed">
            When Service improvement analytics is enabled, CathoScroll loads Vercel Web Analytics for aggregate site-level traffic measurement.
            Vercel states that it does not use third-party cookies and derives a short-lived visitor
            hash from the incoming request, discarded after 24 hours. Its data points may include
            timestamps, page URLs, referrers, filtered query parameters, approximate geolocation,
            and device and browser information.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll preserves ordinary page-level reporting but replaces topic, category
            and search identifiers with generic route labels, removes query strings and fragments,
            and applies a strict-origin referrer policy so only the referring site's origin is
            exposed by the browser. Vercel's processing of request-derived information remains
            subject to its own privacy documentation and our processor and international-transfer
            review.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            When Service improvement analytics is enabled, first-party topic and Top Comments analytics are collected through separate authenticated and signed-out pipelines. Signed-in events are linked to the account.
            On Android and Electron, unsent signed-in topic, Top Comments and sponsor viewability/click
            events are persisted in the encrypted private activity database, capped at 2,000 events
            per stream and seven days, then removed after server acknowledgement or account sign-out/change.
            Signed-out events are sent only after you enable Service improvement analytics and are stored only as daily aggregate counts; no persistent anonymous visitor identifier or analytics cookie is created.
            If you enable Sponsor measurement, a short-lived random token is held in memory while a signed-out session is active for sponsor frequency controls; only its hash is stored, and raw sponsor session/event records become eligible for deletion after 30 days. Sponsor event attribution can include the topic placement where the sponsor appeared; in a Catholic-content service this context may reveal religious or philosophical interests and may involve special-category data under UK GDPR, which is why this is a separate explicit-consent choice. If you decline Sponsor measurement, no token or hash is created and no visitor/session frequency, viewability or click records are collected. Sponsor placements still appear and campaign/day served totals continue for delivery and pacing. The token is not written to cookies or local storage. Event deduplication receipts are deleted after 30 days. On native apps, unsent
            topic/comment batches are held in app-private SQLite storage until upload, capped at
            2,000 events and deleted after seven days. The queue contains no account, visitor or
            session identifier. On the website, unsent batches remain in page memory only. You can change or withdraw either analytics choice using Manage analytics choices below; withdrawing a choice clears its pending local events.
            Vercel Web Analytics and Speed Insights load only when Service improvement analytics is enabled.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Manage optional analytics</h2>
          <p className="text-text-secondary mb-4 leading-relaxed">
            Service improvement analytics and Sponsor measurement are separate optional choices, both off by default. You can change either choice at any time. Declining them does not affect sign-in, account synchronisation, bookmarks, likes, progress, notes, sponsor delivery or general feed ranking. Recommendation personalisation remains a separate account setting.
          </p>
          <AnalyticsConsentSettingsButton />
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Personalisation</h2>

          <p className="text-text-secondary leading-relaxed">
            Optional personalisation is controlled by your account consent setting. Your consent
            record, selected interests, and private topic-interest profile are stored server-side
            in CathoScroll's database; they are not stored in advertising cookies or used for
            cross-site tracking. On Android and Electron, previously downloaded server-ranked
            personalised pages may be cached in encrypted private storage for up to 12 hours after
            the last successful consent check. You can turn personalisation off and delete the derived profile
            in Account settings. Recommendation profiles use eligible account actions and reading signals recorded
            after personalisation consent, including impressions, reading duration, swipe depth,
            skips, completions and return visits. Enabling personalisation also enables Service
            improvement analytics while it remains on; turn off personalisation before disabling
            that analytics choice. Sponsor measurement remains separate.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Sponsor Payments</h2>

          <p className="text-text-secondary leading-relaxed">
            Individual users do not pay for CathoScroll features. Sponsorship is the only paid
            offering. Sponsor invoices are settled by direct bank transfer outside the app;
            CathoScroll does not embed a card-payment checkout or use payment-processing cookies.
            Sponsor financial records are handled in the sponsor administration and portal
            workflows described in the Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Local Storage and Offline Apps</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses browser local storage, IndexedDB, and app-private device storage for
            essential functions such as session support, offline topic and account data, and pending
            user-requested activity synchronisation. The native app also stores a bounded queue of anonymous topic/comment analytics events in app-private SQLite for up to seven days only while Service improvement analytics is enabled, so events can upload after reconnection. This queue contains no account, visitor or session identifier and is cleared when Service improvement analytics is disabled. The website keeps
            its unsent topic/comment events in memory only. Previously downloaded personalised
            feed page ordering is stored in encrypted private storage. It may be used offline for
            up to 12 hours after the last successful consent check and is pruned after 14 days;
            cached general-ranked pages are stored separately.
            These technologies store
            information on your device but are not browser cookies. Clearing them may remove offline
            data or require you to sign in again; pending unsynchronised activity may be lost.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Third-Party Services</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll relies on third-party service providers which may use cookies or similar
            technologies as part of delivering their services.
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Supabase for authentication, database, and application services.</li>
            <li>Vercel for hosting and first-party site analytics.</li>
            <li>Formspree for contact-form delivery when configured.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Managing Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            Most web browsers allow you to view, manage, restrict, or disable cookies through
            browser settings.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You can restrict cookies through your browser. Blocking essential authentication
            cookies can prevent sign-in and other account features from working. Browser cookie
            controls do not automatically clear local storage or IndexedDB; manage those through
            your browser or device settings. We do not currently use optional advertising cookies
            or cross-site advertising trackers.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">International Users</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is available internationally. Cookies and related data may be processed in
            countries outside your own jurisdiction where our service providers operate.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Changes to This Policy</h2>

          <p className="text-text-secondary leading-relaxed">
            We may update this Cookie Policy from time to time.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            We will publish material changes to this policy. Where a change requires consent under
            applicable law, we will request that consent separately before using the relevant
            non-essential storage or access technology.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Contact</h2>

          <p className="text-text-secondary leading-relaxed">
            Questions regarding this Cookie Policy can be sent to:
          </p>

          <p className="mt-4 font-medium">argentjackjoshua@gmail.com</p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You may also contact us through the{' '}
            <Link href="/contact" className="text-accent hover:underline">
              Contact Page
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
