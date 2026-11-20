import Link from 'next/link';
import { createPageMetadata } from '@/lib/seo';

export const metadata = createPageMetadata({
  title: "Privacy",
  description: "Learn how CathoScroll collects, uses, and protects your personal information.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="container py-12">
      <div className="mt-16 mb-16">
        <h1 className="text-5xl font-extrabold md:text-7xl">Privacy Policy</h1>

        <p className="text-text-secondary mt-4 text-lg">Last updated: 20 November 2026</p>
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
            CathoScroll is operated by Joshua Argent, who is the data controller for the personal data
            described in this policy. CathoScroll provides educational resources focused on Catholic
            theology, Scripture, Church history, prayer, apologetics, and related subjects. You can
            contact the controller using the details at the end of this policy.
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
            <li>Bookmarks.</li>
            <li>Progress and streak data.</li>
            <li>Private notes.</li>
            <li>Comments and replies.</li>
            <li>Likes and interactions.</li>
            <li>Quiz progress and quiz results.</li>
            <li>Learning path progress.</li>
            <li>Technical, device, and security data.</li>
            <li>Optional analytics events and aggregates only where you have enabled the relevant analytics choice.</li>
            <li>Optional analytics consent choices and timestamps for signed-in accounts.</li>
            <li>Optional personalisation consent records, selected category interests, and derived topic-interest scores when you opt in.</li>
            <li>For sponsor representatives: organisation membership, campaign submissions, invoice details, and payment references.</li>
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
            <li>Provide learning paths, quizzes, audio, and other platform features without charging individual users.</li>
            <li>Personalise topic recommendations only where you have explicitly opted in.</li>
            <li>Administer paid sponsor campaigns, invoices, and sponsor account access.</li>
            <li>Measure sponsored campaign delivery and provide sponsors with aggregate campaign reports.</li>
            <li>Improve performance and reliability.</li>
            <li>Measure topic and Top Comments engagement where Service improvement analytics is enabled; when personalisation is enabled, eligible reading signals also inform that user's recommendations.</li>
            <li>Measure sponsor viewability, clicks and frequency only where Sponsor measurement is enabled.</li>
            <li>Monitor abuse, spam, fraud, and security issues.</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Personalisation and Sensitive Interests</h2>

          <p className="text-text-secondary leading-relaxed">
            Personalisation is optional and is off by default. If you explicitly opt in,
            CathoScroll uses your topic-reading activity (including viewable impressions, reading
            duration, swipe depth, skips, completions and return visits), your likes and
            bookmarks, relevant community interactions, and categories you choose to create
            a private profile and personalise recommendations. This also enables Service
            improvement analytics while personalisation is on; turn off personalisation before
            disabling that analytics choice. Sponsor measurement remains separate and optional.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Because CathoScroll focuses on Catholic theology, Scripture, and related
            religious subjects, these interests and activity patterns may reveal or allow
            inferences about religious or philosophical beliefs. We treat this possibility
            as sensitive and only use this profile for personalising your own educational
            recommendations after your explicit opt-in. It is not a declaration of your
            religious affiliation, is not displayed on your public profile, and is not
            shared with sponsors or used for advertising targeting.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You can review the categories and topics influencing your recommendations,
            change your selected interests, or withdraw consent at any time in
            <Link href="/account/personalization" className="text-accent mx-1 hover:underline">Account → Personalisation</Link>.
            Withdrawing consent stops recommendation weighting and deletes derived topic-interest
            scores and selected category interests. Service improvement analytics then becomes
            independently manageable; records already collected remain subject to the stated
            retention period.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Lawful Bases for Processing</h2>

          <p className="text-text-secondary leading-relaxed">
            Where UK data protection law applies, the lawful basis depends on the purpose:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Contract: to create and operate your account and provide features you request.</li>
            <li>Legitimate interests: to secure, maintain, troubleshoot, moderate and prevent abuse, where a documented assessment shows that our interests are not overridden by your rights.</li>
            <li>Consent: for optional Service improvement analytics and Sponsor measurement, including account-linked topic/comment analytics when signed in.</li>
            <li>Explicit consent under Article 6(1)(a) and, where processing reveals religious or philosophical beliefs, Article 9(2)(a): for personalisation and its linked Service improvement analytics, and separately for Sponsor measurement.</li>
            <li>Legal obligation: to keep or disclose information where applicable law requires it.</li>
            <li>Consent: for optional personalisation and the reading analytics it requires. Because this processing may reveal religious or philosophical beliefs, we rely on your explicit consent under Article 6(1)(a) UK GDPR and the Article 9(2)(a) exception for the relevant special-category processing.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Service improvement analytics and Sponsor measurement are separate choices. Service improvement analytics is enabled when you opt into personalisation because reading signals also inform your recommendations; it cannot be disabled until personalisation is turned off. Sponsor measurement remains optional and independent. Topic and comment engagement may reveal religious or philosophical beliefs. We do not create a religious-affiliation label or share private recommendation profiles with sponsors.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You may withdraw personalisation consent in Account settings and analytics consent using Manage analytics choices on the Cookie Policy page. Withdrawal stops future optional collection, clears pending local analytics queues and synchronises signed-in consent changes when the device reconnects. It does not affect processing carried out before withdrawal or essential account and synchronisation features.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Automated Recommendations</h2>

          <p className="text-text-secondary leading-relaxed">
            If you opt in to personalisation, automated ranking uses a private profile derived from
            account actions (progress, bookmarks, likes, comments, comment likes and replies), your
            selected categories, and reading signals recorded after consent (viewable impressions,
            reading duration, swipe depth, skips, completions, return visits and Top Comments
            exposure). This also enables Service improvement analytics while personalisation is on.
            It orders educational topics in your own feed and does not determine access to
            essential services, prices, employment, credit, insurance, or other decisions with
            legal or similarly significant effects. You can turn off personalisation and delete
            the derived profile through Account settings.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            On Android and Electron, previously downloaded server-ranked recommendation pages
            may be used offline for up to 12 hours after the last successful consent check. These
            pages are stored in the encrypted private activity database and are cleared when
            personalisation is withdrawn or the account changes. The app does not calculate a
            new personal profile or infer new interests while offline.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Sponsorships and Payments</h2>

          <p className="text-text-secondary leading-relaxed">
            Individual users do not pay for CathoScroll learning or community features.
            The only paid offering is sponsorship purchased by businesses or organisations.
            Sponsor payments are made by direct bank transfer outside the app; CathoScroll
            does not process user card payments or store card credentials.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            For sponsor organisations and their authorised representatives, we may process
            business contact details, sponsor membership roles, campaign information,
            agreed amounts, invoice balances, payment dates, bank references, and
            transaction identifiers supplied for reconciliation. We do not collect or
            store sponsor bank login credentials or full payment-card details.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Sponsors receive aggregate campaign performance reporting. Campaign/day served totals include
            all eligible deliveries, while viewability, click and click-through measurements include
            only visits where Sponsor measurement was enabled. They do not receive user identities,
            individual reading histories, private notes, personalisation profiles, or raw user-level
            analytics events.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Analytics</h2>

          <p className="text-text-secondary leading-relaxed">
            Service improvement analytics measures topic and Top Comments engagement and helps
            improve CathoScroll. When enabled, signed-in events are linked to your account and may
            reveal religious or philosophical interests; this can involve special-category data.
            Raw events and the restricted daily viewer bridge are retained for up to 180 days,
            then non-identifying daily totals remain. Signed-out events are stored only as daily
            aggregates without account, visitor or session identifiers; deduplication receipts
            become eligible for deletion after 30 days.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Enabling personalisation also enables Service improvement analytics because the same
            eligible reading signals—impressions, viewable time, reading duration, swipe depth,
            skips, completions, return visits and Top Comments exposure—help rank your private
            recommendations. This choice cannot be disabled until personalisation is turned off.
            Withdrawing personalisation deletes the derived profile; service analytics can then be
            managed independently. Sponsor measurement is never used for recommendations.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            On Android and Electron, pending signed-in analytics are stored in encrypted private
            storage and pending signed-out events in app-private SQLite, each capped at 2,000
            events and seven days. Website queues remain in memory. Withdrawal clears the relevant
            pending events. Vercel Web Analytics and Speed Insights load only while Service
            improvement analytics is enabled. CathoScroll removes query strings and fragments and
            replaces topic, category and search identifiers with generic route labels before
            sending performance data; Vercel may separately process route, device, browser,
            country and web-vital information under its own privacy terms.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Sponsor delivery is separate from Sponsor measurement. Sponsor cards may appear even
            when measurement is declined. If enabled, a random session token exists only in active
            page/app memory and its SHA-256 hash supports frequency controls; raw event and
            frequency records become eligible for deletion after 30 days. If declined, no visitor
            token, frequency record, viewability or click event is created; CathoScroll retains
            campaign/day served totals for delivery and pacing. Sponsor reports therefore measure
            only opted-in placements, not every card shown.
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
            These providers may process information on our behalf under contractual and security controls. CathoScroll does not sell personal data. We do not disclose personal reading histories or private personalisation profiles to sponsors. We may disclose information where required by law or to protect the service, users, or our legal rights.
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Supabase for authentication and database services.</li>
            <li>Vercel for hosting, deployment, and site analytics.</li>
            <li>Formspree for contact-form delivery when the optional form integration is configured.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">International Data Processing</h2>

          <p className="text-text-secondary leading-relaxed">
            The primary CathoScroll database and authentication services are hosted by Supabase
            in AWS Stockholm, Sweden (eu-north-1). The website's server-side functions are
            currently deployed by Vercel in the United States (US East, iad1). These locations
            may change as the service develops.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Supabase and Vercel may also process service metadata, support requests, security
            logs, and other information through their own operations and subprocessors in
            additional countries, including the United States and Singapore. This means some
            personal data may be transferred outside the UK and EEA.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Where a transfer is subject to UK data protection transfer rules, we use an applicable
            adequacy decision or another lawful transfer safeguard, such as the UK International
            Data Transfer Addendum or approved Standard Contractual Clauses where applicable.
            Provider information: <Link href="https://supabase.com/legal/customer-resources/data-processing-addendum" className="text-accent underline">Supabase DPA</Link>,
            {' '}<Link href="https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq" className="text-accent underline">Supabase data residency and transfers</Link>,
            {' '}and <Link href="https://vercel.com/legal/dpa" className="text-accent underline">Vercel DPA</Link>.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Data Retention</h2>

          <p className="text-text-secondary leading-relaxed">
            We retain information only for as long as reasonably necessary for the purpose for which it was collected, subject to legal, security, moderation, and accounting requirements. Raw feed, community-card, and sponsor-campaign analytics events, together with the user/day viewer bridge used for unique-viewer reporting, are retained for up to 180 days. Signed-in sponsor frequency-cap records are removed after campaigns have completed or been rejected and the applicable 180-day cutoff has passed. Anonymous sponsor session-frequency and event records are created only when Sponsor measurement is enabled and are removed after 30 days. When Sponsor measurement is declined, no such session records are created; campaign/day served totals without visitor/session identifiers are retained longer. Signed-in analytics consent choices and their change history are retained for as long as needed to demonstrate and administer your choice, subject to account deletion and applicable legal requirements.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            While personalisation is enabled, the private profile uses account actions and reading signals recorded after consent, including viewable impressions, reading duration, swipe depth, skips, completions, return visits and eligible Top Comments exposure. The evidence window is limited to 180 days, with 14-day and 90-day decay horizons. Enabling personalisation also enables Service improvement analytics; turn off personalisation before disabling that choice. Withdrawing personalisation deletes the derived profile and selected category interests. Sponsor measurement remains separate and is never used for recommendation ranking.
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
            <li>Request deletion or restriction of personal information.</li>
            <li>Object to certain processing activities.</li>
            <li>Request a copy of certain information held about you, including data portability where applicable.</li>
            <li>Withdraw consent at any time where processing is based on consent.</li>
            <li>Complain to the <Link href="https://ico.org.uk/make-a-complaint/" className="text-accent underline">UK Information Commissioner's Office (ICO)</Link>, or your local supervisory authority.</li>
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
            We will publish the updated policy and, where required, provide additional notice or obtain fresh consent before carrying out materially changed consent-based processing.
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
