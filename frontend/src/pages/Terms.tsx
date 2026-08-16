import { Link } from "react-router-dom";
import { LegalLayout, LegalSection } from "../components/LegalLayout";

const SUPPORT_EMAIL = "support@bizzcore.in";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="16 August 2026">
      <LegalSection heading="1. Acceptance of Terms">
        <p>
          These Terms of Service ("Terms") govern your access to and use of BizzCore ("we," "us," or
          "our"), including our website (<a href="https://bizzcore.in" className="text-maroon hover:underline">https://bizzcore.in</a>),
          web applications, dashboards, tools, and integrated services. By creating an account,
          logging in, or using BizzCore, you agree to be bound by these Terms. If you do not agree,
          you must not access or use the platform.
        </p>
      </LegalSection>

      <LegalSection heading="2. About BizzCore">
        <p>
          BizzCore provides a centralized digital operations platform for businesses. Our services
          include: customer and lead relationship management (CRM); communication management and
          messaging tools; website and digital presence management; social media management and
          integration; automation, reporting, and business analytics.
        </p>
      </LegalSection>

      <LegalSection heading="3. Account Registration & Security">
        <p>
          <strong>Account Creation:</strong> you must provide accurate, complete, and current
          information when registering an account.
        </p>
        <p>
          <strong>Account Responsibility:</strong> you are responsible for all activities that occur
          under your account credentials.
        </p>
        <p>
          <strong>Security & Confidentiality:</strong> you must maintain the security of your login
          details and notify us immediately of any unauthorized access or security breach.
        </p>
      </LegalSection>

      <LegalSection heading="4. Business & Customer Data Ownership">
        <p>
          <strong>Data Rights:</strong> you retain all ownership rights over the data you submit to
          BizzCore (including customer records, contact lists, and uploaded content).
        </p>
        <p>
          <strong>Compliance & Permissions:</strong> you represent and warrant that you have obtained
          all necessary permissions and legal rights to collect, upload, and process your customer
          data using BizzCore.
        </p>
        <p>
          <strong>Privacy Policy:</strong> our processing of personal data is detailed in our{" "}
          <Link to="/privacy" className="text-maroon hover:underline">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="5. Third-Party Platform Integrations">
        <p>
          BizzCore enables integrations with third-party platforms, including Meta Platforms, Inc.
          (Facebook Pages, Instagram Professional Accounts, WhatsApp Business API), hosting
          providers, and communication providers.
        </p>
        <p>
          <strong>Authorization:</strong> connecting a third-party account authorizes BizzCore to
          access, send, and receive data from that platform as permitted by your account
          configuration and API permissions.
        </p>
        <p>
          <strong>Third-Party Terms:</strong> your use of connected services remains subject to the
          respective terms and policies of those third-party providers (e.g., Meta Terms of
          Service).
        </p>
        <p>
          <strong>Service Availability:</strong> BizzCore is not responsible for outages, API
          changes, or service interruptions caused by third-party platforms.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable Use Policy">
        <p>You agree not to use BizzCore to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>violate any local, national, or international laws or regulations;</li>
          <li>send unauthorized spam, bulk unsolicited messages, or prohibited commercial content;</li>
          <li>store, transmit, or distribute malicious code, viruses, or harmful software;</li>
          <li>attempt to bypass security controls, gain unauthorized access, or breach multi-tenant data boundaries;</li>
          <li>infringe upon the intellectual property or privacy rights of third parties.</li>
        </ul>
        <p>
          <strong>AI-Generated Content:</strong> content generated using BizzCore's AI features (AI
          Marketing Assistant, Content Research Lab) may contain inaccuracies. You are responsible
          for reviewing all AI-generated content before publishing or sending it to your customers.
        </p>
      </LegalSection>

      <LegalSection heading="7. Subscriptions, Fees & Billing">
        <p>
          <strong>Plans & Fees:</strong> access to certain BizzCore features requires a paid
          subscription. Pricing details and billing terms are specified during plan selection or
          order confirmation.
        </p>
        <p>
          <strong>Payment Terms:</strong> fees are billed in advance on a recurring schedule (monthly
          or annually). All fees are non-refundable unless required by applicable law or stated
          otherwise in your service agreement.
        </p>
        <p>
          <strong>Modifications:</strong> we reserve the right to modify subscription pricing with
          prior notice to account administrators.
        </p>
      </LegalSection>

      <LegalSection heading="8. Intellectual Property Rights">
        <p>
          <strong>BizzCore Rights:</strong> the BizzCore service, software, user interface designs,
          logos, trademarks, and underlying technology remain the exclusive property of BizzCore.
        </p>
        <p>
          <strong>Restrictions:</strong> you may not copy, modify, distribute, reverse engineer, or
          create derivative works based on BizzCore without express written consent.
        </p>
      </LegalSection>

      <LegalSection heading="9. Service Modification & Termination">
        <p>
          <strong>Account Deletion:</strong> you may stop using BizzCore and request account
          termination at any time via support. For data purge requests, see{" "}
          <Link to="/data-deletion" className="text-maroon hover:underline">https://bizzcore.in/data-deletion</Link>.
        </p>
        <p>
          <strong>Suspension Rights:</strong> we reserve the right to suspend or terminate accounts
          that breach these Terms, misuse third-party integrations, or engage in abusive or illegal
          activities.
        </p>
      </LegalSection>

      <LegalSection heading="10. Limitation of Liability & Disclaimers">
        <p>
          <strong>"As-Is" Service:</strong> BizzCore is provided on an "AS IS" and "AS AVAILABLE"
          basis without warranties of any kind, express or implied.
        </p>
        <p>
          <strong>Liability Cap:</strong> to the maximum extent permitted by applicable law, BizzCore
          shall not be liable for indirect, incidental, consequential, or punitive damages, including
          loss of profits, data, or business opportunities.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to Terms">
        <p>
          We may update these Terms from time to time to reflect operational, legal, or platform
          updates. Any changes will be posted on this page with an updated "Last Updated" date.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact Us">
        <p>
          For questions regarding these Terms of Service, reach out to support at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-maroon hover:underline">{SUPPORT_EMAIL}</a>{" "}
          or visit <a href="https://bizzcore.in" className="text-maroon hover:underline">https://bizzcore.in</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
