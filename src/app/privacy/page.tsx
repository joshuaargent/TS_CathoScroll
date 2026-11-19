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

        <p className="text-text-secondary mt-4 text-lg">Last updated: 19 November 2026</p>
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
            <li>Technical, device, security, and analytics data.</li>
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
            <li>Monitor abuse, spam, fraud, and security issues.</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Personalisation and Sensitive Interests</h2>

          <p className="text-text-secondary leading-relaxed">
            Personalisation is optional and is off by default. If you explicitly opt in,
            CathoScroll may use your topic-reading activity (such as viewable reading time,
            completion, repeat visits, and skips), your likes and bookmarks, relevant
            community interactions, and category interests you choose to create a private
            content-interest profile and personalise your topic recommendations.
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
            Withdrawing consent stops profile-based recommendation weighting and deletes
            the derived topic-interest scores and selected category interests. It does not
            erase separate operational analytics records that are retained for their
            stated operational period.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Lawful Bases for Processing</h2>

          <p className="text-text-secondary leading-relaxed">
            Where UK data protection law applies, the lawful basis depends on the purpose:
          </p>

          <ul className="text-text-secondary mt-4 list-disc space-y-2 pl-6">
            <li>Contract: to create and operate your account and provide features you request.</li>
            <li>Legitimate interests: to secure, maintain, troubleshoot, moderate, and improve the service, prevent abuse, and measure aggregate service performance, where those interests are not overridden by your rights.</li>
            <li>Legal obligation: to keep or disclose information where applicable law requires it.</li>
            <li>Consent: for optional personalisation. Because this processing may reveal religious or philosophical beliefs, we rely on your explicit consent under Article 6(1)(a) UK GDPR and the Article 9(2)(a) exception for the relevant special-category processing.</li>
          </ul>

          <p className="text-text-secondary mt-4 leading-relaxed">
            You may withdraw personalisation consent at any time using the account
            controls described above. Withdrawal does not affect processing carried out
            before withdrawal.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Automated Recommendations</h2>

          <p className="text-text-secondary leading-relaxed">
            If you opt in to personalisation, automated ranking uses your private content-interest
            profile to order educational topics in your own feed. It does not determine access to
            essential services, prices, employment, credit, insurance, or other decisions with
            legal or similarly significant effects. You can turn off personalisation and delete
            the derived profile through Account settings.
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
            Sponsors receive aggregate campaign performance reporting. They do not receive
            user identities, individual reading histories, private notes, personalisation
            profiles, or raw user-level analytics events.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-3xl font-bold">Analytics</h2>

          <p className="text-text-secondary leading-relaxed">
            CathoScroll uses analytics to measure general site usage, understand feed performance,
            diagnose reliability issues, protect the service, and improve the user experience.
            Analytics is separate from optional recommendation personalisation and is not used for
            sponsor targeting.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            For signed-in users, CathoScroll's first-party feed analytics currently records topic
            and comment-card impressions, viewability, active duration, skips, completions, repeat
            visits, and related interactions. These raw events are linked to the account and the
            topic or card involved. Raw event records and the user/day viewer bridge are retained
            for up to 180 days; daily totals without user or session identifiers are retained
            longer. These records are not anonymous while identifiers are retained and are not
            provided to sponsors or used for sponsor targeting. Turning off recommendation
            personalisation does not itself switch off this separate operational analytics stream.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Topic-level reading activity on a Catholic learning platform can reveal or allow
            inferences about religious or philosophical beliefs. It therefore requires a separate
            UK GDPR Article 6 basis and Article 9 condition; the personalisation checkbox is not
            consent for this operational analytics. Our provisional analytics impact assessment
            records the lawful-basis review for this account-linked stream as outstanding; the
            assessment does not certify the current topic-level processing as legally approved.
            CathoScroll does not currently record first-party topic-level feed events from signed-out
            visitors. It does not attach signed-out feed activity to an account or create a
            persistent visitor profile for that purpose.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            CathoScroll uses Vercel Web Analytics for aggregate site-level traffic measurement,
            including visits from people who are not signed in. Vercel states that it does not use
            third-party cookies and derives a short-lived visitor hash from the incoming request,
            which is discarded after 24 hours. Its analytics data points may include timestamps,
            page URLs, referrers, filtered query parameters, approximate geolocation, and device
            and browser information. CathoScroll configures the analytics event hook to replace
            every page URL with the site root and remove query strings and fragments, so topic
            paths and query values are not sent as page URLs. Vercel's own processing and any
            request-level metadata remain subject to Vercel's privacy documentation and our
            processor and international-transfer review.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            Vercel Speed Insights has been disabled while its separate data fields and processing
            are assessed. Site-level Vercel Web Analytics reports are provider-level aggregates;
            they are not first-party topic impressions, reading duration, skips, or completions and
            are not merged into CathoScroll's Admin Analytics topic/event tables. The app does not
            claim that a short-lived hash or provider-level aggregate is automatically anonymous
            for every legal purpose.
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
            We retain information only for as long as reasonably necessary for the purpose for which it was collected, subject to legal, security, moderation, and accounting requirements. Raw feed, community-card, and sponsor-campaign analytics events, together with the user/day viewer bridge used for unique-viewer reporting, are retained for up to 180 days. Sponsor frequency-cap records are removed after campaigns have completed or been rejected and the applicable 180-day cutoff has passed. Daily totals that do not contain user or session identifiers are retained longer.
          </p>

          <p className="text-text-secondary mt-4 leading-relaxed">
            While personalisation is enabled, behavioural topic-interest scores use a rolling evidence window of up to 90 days. Explicit account interactions such as likes, bookmarks, progress and comment engagement use a maximum 180-day evidence window. Explicit category choices remain stored while consent remains enabled. When you withdraw consent, the derived profile and explicit category choices are deleted. The separate operational analytics event records are not deleted by withdrawing personalisation consent and remain subject to their own retention period.
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
