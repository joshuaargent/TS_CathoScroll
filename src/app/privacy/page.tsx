import Link from 'next/link';
import type { Metadata } from 'next';
import { siteConfig } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Learn how CathoScroll collects, uses, and protects your personal information.',
  alternates: {
    canonical: new URL('/privacy', siteConfig.url).toString(),
  },
};

export default function PrivacyPage() {
  return (
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Privacy Policy</h1>

        <p className="text-text-secondary mt-4 text-lg">Last updated: 31 October 2026</p>
      </div>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 text-3xl font-bold">Introduction</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll respects your privacy and is committed to protecting your personal
            information.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            This Privacy Policy explains what information we collect, how we use it, who we share it
            with, and the choices available to you regarding your data.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Who We Are</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is operated by Joshua Argent and provides educational resources focused on
            Catholic theology, Scripture, Church history, prayer, apologetics, and related subjects.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Information We Collect</h2>

          <p className="text-text-secondary leading-relaxed">
            We may collect the following categories of information:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Email address.</li>
            <li>Username.</li>
            <li>Display name.</li>
            <li>Profile biography.</li>
            <li>Subscription status.</li>
            <li>Bookmarks.</li>
            <li>Progress and streak data.</li>
            <li>Private notes.</li>
            <li>Comments and replies.</li>
            <li>Likes and interactions.</li>
            <li>Quiz progress and quiz results.</li>
            <li>Learning path progress.</li>
            <li>Technical and analytics data.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Public Information</h2>

          <p className="text-text-secondary leading-relaxed">
            Certain information is publicly visible to other users.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Public information may include:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Username.</li>
            <li>Display name.</li>
            <li>Profile biography.</li>
            <li>Comments and replies.</li>
            <li>Comment likes and interactions.</li>
            <li>Public profile statistics.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Please avoid posting sensitive personal information within public comments or profile
            content.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Private Information</h2>

          <p className="text-text-secondary leading-relaxed">
            Personal notes are private and are not displayed publicly.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Authentication information and account data are not published to other users.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How We Use Information</h2>

          <p className="text-text-secondary leading-relaxed">We use information to:</p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Provide and operate CathoScroll.</li>
            <li>Create and manage user accounts.</li>
            <li>Track learning progress.</li>
            <li>Save bookmarks and notes.</li>
            <li>Display comments and profiles.</li>
            <li>Deliver premium features.</li>
            <li>Provide audio lessons.</li>
            <li>Provide quizzes and learning paths.</li>
            <li>Improve performance and reliability.</li>
            <li>Monitor abuse, spam, fraud, and security issues.</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Premium Subscriptions</h2>

          <p className="text-text-secondary leading-relaxed">
            If you purchase a premium subscription, payment processing is handled by our payment
            provider.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll does not store complete payment card numbers or payment credentials.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            We may store information relating to subscription status, billing history, and access
            permissions in order to manage premium features.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Analytics</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses analytics tools to understand how the platform is used and to improve
            performance and user experience.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            This may include information such as pages visited, browser type, device information,
            approximate location derived from network information, and usage patterns.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll currently uses Vercel Analytics for site analytics and performance insights.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Cookies and Authentication</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses cookies and similar technologies to maintain user sessions,
            authenticate accounts, improve security, and enable core platform functionality.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Disabling cookies may prevent certain features from functioning correctly.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Third-Party Services</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll relies on third-party providers to deliver the service.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            These providers may process information on our behalf.
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Supabase for authentication and database services.</li>
            <li>Vercel for hosting and analytics.</li>
            <li>Stripe for payment processing and subscription management.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">International Data Processing</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is available internationally.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Information may be transferred to, processed in, and stored in countries outside your
            own jurisdiction, including locations where our service providers operate.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            By using CathoScroll, you acknowledge that such transfers may occur.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Data Retention</h2>

          <p className="text-text-secondary leading-relaxed">
            We retain information for as long as reasonably necessary to operate CathoScroll and
            fulfil the purposes described in this policy.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Information may be retained after account closure where necessary for legal obligations,
            dispute resolution, moderation records, security investigations, prevention of abuse, or
            legitimate business purposes.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Account Deletion</h2>

          <p className="text-text-secondary leading-relaxed">
            If you would like your account deleted, please contact us directly.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            We will make reasonable efforts to delete or anonymise personal information associated
            with your account, subject to legal, security, operational, and moderation requirements.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Your Rights</h2>

          <p className="text-text-secondary leading-relaxed">
            Depending on your location, you may have rights relating to your personal information,
            including rights to:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Access your information.</li>
            <li>Correct inaccurate information.</li>
            <li>Request deletion of personal information.</li>
            <li>Object to certain processing activities.</li>
            <li>Request a copy of certain information held about you.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            To exercise these rights, please contact us.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Children's Privacy</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is not directed toward children under 13.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            If we become aware that personal information has been collected in violation of
            applicable age requirements, we will take reasonable steps to remove it.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Security</h2>

          <p className="text-text-secondary leading-relaxed">
            We take reasonable measures to protect information against unauthorised access,
            disclosure, alteration, loss, or destruction.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            However, no system of storage, transmission, or processing can be guaranteed to be
            completely secure.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Changes to This Policy</h2>

          <p className="text-text-secondary leading-relaxed">
            We may update this Privacy Policy from time to time.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Continued use of CathoScroll after changes are published constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Contact</h2>

          <p className="text-text-secondary leading-relaxed">
            Questions about this Privacy Policy can be sent to:
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
