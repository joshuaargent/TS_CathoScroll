import Link from 'next/link';

import { Button } from '@/components/ui/Button';

export default function FAQPage() {
  return (
    <main className="container py-12">
      <div className="mt-8 mb-24">
        <h1 className="text-5xl font-extrabold md:text-7xl">Frequently Asked Questions</h1>

        <p className="text-text-secondary mt-6 max-w-3xl text-xl">
          Answers to common questions about CathoScroll, learning paths, subscriptions, accounts,
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
          <h2 className="mb-4 text-3xl font-bold">What is CathoScroll Premium?</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll Premium provides additional learning tools designed for users who want a
            more structured study experience.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">Premium includes:</p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Audio versions of topics.</li>
            <li>Structured learning paths.</li>
            <li>Interactive quizzes.</li>
          </ul>
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
            tracking, learning progress, and premium features.
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
          <h2 className="mb-4 text-3xl font-bold">How much does Premium cost?</h2>

          <p className="text-text-secondary leading-relaxed">
            Premium pricing is displayed on the Premium page and during the subscription process.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Do you offer refunds?</h2>

          <p className="text-text-secondary leading-relaxed">
            Subscription purchases are non refundable except where required by applicable law.
            Please review the Terms of Service for complete details.
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
