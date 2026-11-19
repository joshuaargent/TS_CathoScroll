import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';

import { Button } from '@/components/ui/Button';

export const metadata = createPageMetadata({
  title: "FAQs",
  description: "Answers to common questions about CathoScroll, Catholic learning, accounts, and sponsorships.",
  path: "/faq",
});

export default function FAQPage() {
  return (
    <main className="container py-12">
      <div className="mt-8 mb-24">
        <h1 className="text-5xl font-extrabold md:text-7xl">Frequently Asked Questions</h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Answers to common questions about CathoScroll, learning paths, accounts,
          and the platform.
        </p>
      </div>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 text-3xl font-bold">What is CathoScroll?</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is an educational platform designed to help people learn about the Catholic
            faith through topics covering theology, Scripture, apologetics, Church history, prayer,
            morality, and doctrine.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Is CathoScroll free?</h2>

          <p className="text-text-secondary leading-relaxed">
            Yes. Core features including topics, categories, search, profiles, bookmarks, progress
            tracking, and community discussions are available for free.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Do users have to pay for CathoScroll?</h2>

          <p className="text-text-secondary leading-relaxed">
            No. CathoScroll's learning and community features are free to individual users.
            We do not sell paid memberships, paid learning content, or user subscriptions.
            The only paid commercial offering is sponsorship purchased by businesses and
            organisations. Sponsored placements are clearly labelled.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How do sponsorships work?</h2>

          <p className="text-text-secondary leading-relaxed">
            Businesses and organisations can pay for approved sponsored placements in the
            feed. These are visibly labelled as sponsored and remain separate from organic
            topic recommendations. Sponsors receive aggregate campaign reporting, not
            individual users' identities or reading histories. Sponsor payments are handled
            by direct bank transfer outside the app.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Are learning paths, quizzes and audio paid?</h2>

          <p className="text-text-secondary leading-relaxed">
            No. Learning paths, quizzes, audio learning features and other learning tools
            are available without a paid user membership.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">What are learning paths?</h2>

          <p className="text-text-secondary leading-relaxed">
            Learning paths are structured courses that guide users through specific areas of
            Catholic teaching in a logical order.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Rather than choosing topics randomly, learning paths help users build understanding
            progressively from one lesson to the next.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How do quizzes work?</h2>

          <p className="text-text-secondary leading-relaxed">
            Quizzes are designed to reinforce learning and help users review key concepts covered in
            topics and learning paths.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Quiz results are intended as a learning aid and do not constitute any form of official
            qualification or certification.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Who creates the content?</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll was created by Joshua Argent. Topics are researched and written with the aim
            of presenting Catholic teaching clearly, accurately, and accessibly.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Is CathoScroll affiliated with the Catholic Church?
          </h2>

          <p className="text-text-secondary leading-relaxed">
            No. CathoScroll is an independent educational project and is not officially operated by
            or affiliated with the Vatican, the Holy See, a diocese, or any Catholic institution
            unless explicitly stated.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Do I need an account?</h2>

          <p className="text-text-secondary leading-relaxed">
            No. You can browse topics without creating an account.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            However, an account is required for features such as comments, bookmarks, progress
            tracking, learning progress, and all available learning features.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Are my notes visible to other users?</h2>

          <p className="text-text-secondary leading-relaxed">
            No. Personal notes are private and are not visible to other users.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Are comments public?</h2>

          <p className="text-text-secondary leading-relaxed">
            Yes. Comments and replies are publicly visible to other users of CathoScroll.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Usernames, display names, profile biographies, and public activity associated with
            comments may also be visible.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Can I change my username?</h2>

          <p className="text-text-secondary leading-relaxed">
            Usernames can be changed through account settings, subject to availability and platform
            restrictions.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Can I delete my account?</h2>

          <p className="text-text-secondary leading-relaxed">
            Yes. If you would like your account deleted, please contact us and we will assist you
            with the process.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How much does a sponsorship cost?</h2>

          <p className="text-text-secondary leading-relaxed">
            Sponsorship prices are agreed individually based on the campaign, dates, and
            agreed delivery. There is no user subscription or public fixed sponsor price.
            Sponsor terms are confirmed in writing before a campaign begins.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Do sponsors receive my personal data?</h2>

          <p className="text-text-secondary leading-relaxed">
            No. Sponsors receive aggregate campaign reporting only. They do not receive
            your identity, reading history, personalisation profile, or individual activity.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">How can I report a bug or suggest a feature?</h2>

          <p className="text-text-secondary leading-relaxed">
            Feedback is always welcome. You can use the Contact page to report bugs, suggest
            improvements, recommend topics, or share general feedback.
          </p>

          <div className="mt-6">
            <Link href="/contact">
              <Button
                size="lg"
                style={{
                  color: '#ffffff',
                }}
              >
                Contact Us
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
