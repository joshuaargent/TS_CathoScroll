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
            Service improvement analytics measures topic and Top Comments engagement. Signed-in
            events are linked to your account; signed-out events are stored only as daily topic or
            comment totals, without account, visitor or session identifiers. Deduplication
            receipts are deleted after 30 days. Website retry batches stay in memory; Android and
            Electron store pending events in app-private storage for up to seven days, capped at
            2,000 per stream. Withdrawal clears pending events.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Enabling personalisation also enables Service improvement analytics because eligible
            reading signals inform your private recommendations. This analytics choice is locked
            on until personalisation is turned off. Sponsor measurement is separate: if enabled,
            a random token exists only in active memory and its hash supports frequency controls;
            raw event/frequency records are deleted after 30 days. If declined, no token, hash,
            per-session frequency, viewability or click record is created; campaign/day served
            totals still support delivery and pacing. Sponsor placement context may reveal
            religious or philosophical interests, so measurement requires explicit consent.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Vercel Web Analytics and Speed Insights load only when Service improvement analytics
            is enabled. CathoScroll removes query strings and fragments and replaces topic,
            category and search identifiers with generic route labels before sending performance
            data. Vercel may separately process timestamps, page routes, referrers, approximate
            location, device/browser information and web-vital measurements under its privacy
            terms.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Manage optional analytics</h2>
          <p className="text-text-secondary mb-4 leading-relaxed">
            Service improvement analytics starts off and can be managed independently when personalisation is off. Enabling personalisation also enables Service improvement analytics and locks it on until personalisation is disabled. Sponsor measurement is always a separate optional choice. Declining optional analytics does not affect sign-in, account synchronisation, bookmarks, likes, progress, notes, sponsor delivery or general feed ranking.
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
            CathoScroll uses browser local storage, IndexedDB and app-private storage for sign-in,
            offline content and pending synchronisation. Native apps keep a bounded, identifier-free
            analytics retry queue for up to seven days while Service improvement analytics is enabled;
            the website keeps unsent events in memory. Personalised feed pages are cached in encrypted
            private storage for up to 12 hours after the last consent check and pruned after 14 days;
            general feed pages use a separate cache. These are device-storage technologies, not
            browser cookies. Clearing them may remove offline data, require sign-in again or lose
            pending activity.
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
