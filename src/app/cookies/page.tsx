import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';

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

        <p className="text-text-secondary mt-4 text-lg">Last updated: 19 November 2026</p>
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
            security, essential preferences, and offline support. We also use first-party site
            analytics and server-side product analytics as described below; these are not used for
            cross-site advertising or to target users with sponsored content.
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
            CathoScroll uses first-party site analytics and authenticated, server-side product
            analytics to understand platform use and improve reliability and learning features.
            These product events are not advertising cookies and are not shared with sponsors at
            an individual-user level.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Analytics information may include:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Pages visited.</li>
            <li>Navigation behaviour.</li>
            <li>Browser and device information.</li>
            <li>General usage trends.</li>
            <li>Performance and reliability metrics.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll uses Vercel Web Analytics for site measurement. Vercel describes this
            product as first-party analytics that does not rely on cookies for its visitor hash. The visitor hash is reset daily and
            does not track visitors across unrelated websites. Our own feed analytics are sent to
            CathoScroll's servers when a signed-in user interacts with the feed. See the Privacy
            Policy for event categories and retention periods.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Personalisation</h2>

          <p className="text-text-secondary leading-relaxed">
            Optional personalisation is controlled by your account consent setting. Your consent
            record, selected interests, and private topic-interest profile are stored server-side
            in CathoScroll's database; they are not stored in advertising cookies or used for
            cross-site tracking. You can turn personalisation off and delete the derived profile
            in Account settings.
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
            essential functions such as session support, offline topic and account data, pending
            activity synchronisation, and retry queues. These technologies store information on
            your device but are not browser cookies. Clearing them may remove offline data or
            require you to sign in again; pending unsynchronised activity may be lost.
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
