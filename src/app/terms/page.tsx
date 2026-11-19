import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: "Terms",
  description: "Terms and conditions for using CathoScroll.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">
          Terms of Service
        </h1>

        <p className="text-text-secondary mt-4 text-lg">
          Last updated: 19 November 2026
        </p>
      </div>

      <div className="space-y-12">
        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Acceptance of Terms
          </h2>

          <p className="text-text-secondary leading-relaxed">
            By accessing, browsing, creating an account, or otherwise using
            CathoScroll, you agree to be bound
            by these Terms of Service.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            If you do not agree to these Terms, you must not access or use
            CathoScroll.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            About CathoScroll
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is an educational platform operated by Joshua Argent.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll provides educational content relating to Catholic
            theology, Scripture, doctrine, apologetics, Church history, prayer,
            morality, and related subjects.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll is not affiliated with, endorsed by, or operated by the
            Holy See, the Vatican, the Catholic Church as an institution, or
            any diocese unless explicitly stated.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Eligibility
          </h2>

          <p className="text-text-secondary leading-relaxed">
            You must be at least 13 years old, or the minimum age required by
            the laws of your country, to use CathoScroll.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            If you are under the age of majority in your jurisdiction, you must
            have permission from a parent or legal guardian before using the
            platform.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Accounts and Security
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Certain features of CathoScroll require an account.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You are responsible for maintaining the confidentiality and security
            of your login credentials and for all activity that occurs under
            your account.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You agree not to:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Impersonate another person.</li>
            <li>Use another user's account.</li>
            <li>Share your account with others.</li>
            <li>Create accounts for deceptive purposes.</li>
            <li>Attempt unauthorised access to systems or data.</li>
            <li>Interfere with the operation of the platform.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Educational Disclaimer
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Content on CathoScroll is provided for educational and informational
            purposes only.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll does not provide legal, medical, financial,
            safeguarding, therapeutic, psychological, or professional pastoral
            advice.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            While reasonable efforts are made to present Catholic teaching
            accurately and faithfully, CathoScroll does not guarantee that all
            material is free from errors, omissions, differing theological
            interpretations, or inaccuracies.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Users remain responsible for evaluating and verifying information
            where appropriate.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Free Features
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Free features may include:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Topic browsing</li>
            <li>Search</li>
            <li>Categories</li>
            <li>Bookmarks</li>
            <li>Progress tracking</li>
            <li>Profiles</li>
            <li>Comments and replies</li>
            <li>Community features</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Free features may change, expand, or be removed as CathoScroll
            develops.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Free Access
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll does not charge individual users for access to its learning,
            reading, search, account, progress, or community features. We do not offer
            paid user memberships, premium content subscriptions, or paywalled learning
            features. This includes available and future learning paths, quizzes, and
            audio learning features.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Sponsorships and Sponsored Content
          </h2>

          <p className="text-text-secondary leading-relaxed">
            The only paid commercial offering on CathoScroll is sponsorship purchased
            by businesses or organisations. Sponsors pay CathoScroll for approved
            campaign placements. Sponsored cards and other paid placements are clearly
            identified as sponsored and are distinct from organic educational content
            and community contributions.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Sponsorship does not purchase editorial control over Catholic teaching,
            individual topics, community discussion, or organic recommendation rankings.
            Sponsor payments and campaign delivery are managed separately from user
            accounts. Sponsor representatives receive aggregate campaign reporting only;
            they are not given individual users' identities, reading histories, or private
            personalisation profiles.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Sponsor campaign scope, placement dates, agreed amounts, payment milestones,
            cancellation arrangements, and any refund terms are set out in the relevant
            written sponsor agreement or invoice. Sponsor payments are made by direct
            bank transfer outside the CathoScroll app. CathoScroll does not currently
            process user or sponsor card payments within the app.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Personalised Recommendations
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Personalised recommendations are optional. They remain off unless you
            explicitly opt in. If you opt in, CathoScroll uses eligible activity and
            interests you select to build a private content-interest profile and improve
            topic recommendations. Because the platform covers Catholic and religious
            subjects, this activity may reveal information about religious or
            philosophical beliefs. You can withdraw consent and delete the derived
            profile through Account settings at any time. Further details are in our
            <Link href="/privacy" className="text-accent ml-1 hover:underline">Privacy Policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Learning Paths, Quizzes and Audio Content
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Learning paths, quizzes, and audio lessons are provided for
            personal educational use only.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Completion of learning paths, lessons, or quizzes does not
            constitute an academic qualification, professional certification,
            licence, accreditation, endorsement, or guarantee of competence.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Audio recordings may not be copied, redistributed, republished,
            uploaded elsewhere, sold, or commercially exploited without prior
            permission.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll does not guarantee educational outcomes, examination
            performance, mastery of subject matter, spiritual growth, or
            formation results.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Community Standards
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Users must engage respectfully and responsibly.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Prohibited behaviour includes:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Harassment or abuse.</li>
            <li>Threats or intimidation.</li>
            <li>Spam.</li>
            <li>Illegal content.</li>
            <li>Malicious software or links.</li>
            <li>Fraudulent activity.</li>
            <li>Attempts to disrupt the platform.</li>
            <li>Impersonation.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            User Content
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Users retain ownership of comments, replies, biographies, usernames,
            display names, and other content they create.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            By submitting content, you grant CathoScroll a worldwide,
            non-exclusive, royalty-free licence to host, store, display,
            reproduce, distribute, and make available that content for the
            operation, improvement, moderation, and promotion of the platform.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Moderation
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll reserves the right to moderate content and accounts.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Moderation actions may include:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Removing content.</li>
            <li>Editing or hiding content.</li>
            <li>Pinning content.</li>
            <li>Restricting accounts.</li>
            <li>Suspending accounts.</li>
            <li>Permanently banning accounts.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Moderation decisions are made at CathoScroll's discretion.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Intellectual Property
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll, including its design, branding, software, educational
            materials, quizzes, learning paths, audio recordings, written
            content, and original resources, is protected by intellectual
            property laws.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You may not copy, reproduce, redistribute, republish, sell, modify,
            or commercially exploit CathoScroll content without permission.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Copyright Complaints
          </h2>

          <p className="text-text-secondary leading-relaxed">
            If you believe content on CathoScroll infringes your copyright,
            please contact us with sufficient information for investigation and
            response.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Availability of Service
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is provided on an "as available" and "as is" basis.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            We do not guarantee uninterrupted service, continuous availability,
            or the availability of any specific feature.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Features may be modified, suspended, replaced, restricted, or
            discontinued at any time.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Limitation of Liability
          </h2>

          <p className="text-text-secondary leading-relaxed">
            To the fullest extent permitted by law, CathoScroll and its operator
            shall not be liable for indirect, incidental, special,
            consequential, punitive, or exemplary damages arising from use of
            the platform.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            This includes loss of profits, business interruption, loss of
            goodwill, data loss, service interruption, or reliance on content
            available through CathoScroll.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Indemnification
          </h2>

          <p className="text-text-secondary leading-relaxed">
            You agree to indemnify and hold harmless CathoScroll and its
            operator from claims, liabilities, damages, losses, and expenses
            arising from your misuse of the platform, violation of these Terms,
            or infringement of the rights of any third party.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Force Majeure
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll shall not be liable for delays, interruptions, or
            failures resulting from circumstances beyond reasonable control,
            including natural disasters, war, government action, internet
            failures, cyberattacks, infrastructure failures, or third-party
            service outages.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Account Deletion
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Account deletion requests must be submitted by contacting
            CathoScroll directly.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Certain information may be retained where reasonably necessary for
            moderation, legal obligations, dispute resolution, security
            purposes, or operational records.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            International Users
          </h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll is available internationally. Users are responsible for
            ensuring their use of the platform complies with local laws that may
            apply in their jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Governing Law
          </h2>

          <p className="text-text-secondary leading-relaxed">
            These Terms shall be governed by and interpreted in accordance with
            the laws of England and Wales.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Any dispute arising from or relating to these Terms or CathoScroll
            shall be subject to the jurisdiction of the courts of England and
            Wales.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Severability
          </h2>

          <p className="text-text-secondary leading-relaxed">
            If any provision of these Terms is found to be invalid or
            unenforceable, the remaining provisions shall remain in full force
            and effect.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            No Waiver
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Failure to enforce any provision of these Terms shall not constitute
            a waiver of that provision or any other provision.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Entire Agreement
          </h2>

          <p className="text-text-secondary leading-relaxed">
            These Terms constitute the entire agreement between you and
            CathoScroll in relation to the platform and supersede prior
            understandings relating to its use.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Changes to These Terms
          </h2>

          <p className="text-text-secondary leading-relaxed">
            We may update these Terms from time to time.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Continued use of CathoScroll after updated Terms are published
            constitutes acceptance of those changes.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">
            Contact
          </h2>

          <p className="text-text-secondary leading-relaxed">
            Questions regarding these Terms can be sent to:
          </p>

          <p className="mt-4 font-medium">
            argentjackjoshua@gmail.com
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You may also contact us via the{' '}
            <Link
              href="/contact"
              className="text-accent hover:underline"
            >
              Contact Page
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}