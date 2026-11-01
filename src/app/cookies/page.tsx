import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cookies',
  description: 'How CathoScroll uses cookies and similar technologies.',
};

export default function CookiesPage() {
  return (
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Cookie Policy</h1>

        <p className="text-text-secondary mt-4 text-lg">Last updated: 31 October 2026</p>
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
          <h2 className="mb-4 text-3xl font-bold">How CathoScroll Uses Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses cookies and similar technologies to provide core functionality,
            maintain authentication sessions, improve security, remember preferences, analyse usage,
            and operate premium features.
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
          <h2 className="mb-4 text-3xl font-bold">Analytics Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses analytics technologies to understand how visitors interact with the
            platform and to improve performance, functionality, and user experience.
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
            CathoScroll currently uses Vercel Analytics to help understand and improve platform
            usage.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Payment Processing Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            Premium subscriptions on CathoScroll are processed through Stripe.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Stripe may use cookies and similar technologies to:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Process subscription payments.</li>
            <li>Authenticate payment requests.</li>
            <li>Prevent fraud and abuse.</li>
            <li>Maintain payment security.</li>
            <li>Comply with legal and financial obligations.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            These technologies are controlled by Stripe and are subject to Stripe's own privacy and
            cookie practices.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Third-Party Services</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll relies on third-party service providers which may use cookies or similar
            technologies as part of delivering their services.
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Supabase for authentication and database services.</li>
            <li>Vercel for hosting and analytics.</li>
            <li>Stripe for payment processing and subscription management.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Managing Cookies</h2>

          <p className="text-text-secondary leading-relaxed">
            Most web browsers allow you to view, manage, restrict, or disable cookies through
            browser settings.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Disabling cookies may affect the operation of CathoScroll and may prevent certain
            features from functioning correctly.
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
            Continued use of CathoScroll after changes are published constitutes acceptance of the
            updated policy.
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
