import { Link } from "react-router-dom";
import { LegalLayout, LegalSection } from "../components/LegalLayout";

const LEGAL_ENTITY_NAME = "BizzCore";
const SUPPORT_EMAIL = "support@bizzcore.in";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="29 July 2026">
      <LegalSection heading="1. Who We Are">
        <p>
          This Privacy Policy describes how {LEGAL_ENTITY_NAME} ("we," "us," or "our"), operating
          the platform BizzCore (<a href="https://bizzcore.in" className="text-maroon hover:underline">https://bizzcore.in</a>),
          processes information collected through our platform, website, and integrated services.
          For inquiries regarding this policy, contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-maroon hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Whose Data This Covers">
        <p>
          Two main categories of data pass through BizzCore: Business Account Data (information
          provided by administrative users to manage their BizzCore account, including owner/staff
          names, business emails, billing details, and login credentials) and Customer Data (data
          stored by a business about its customers — names, phone numbers, order histories, notes).
          The business owns this data; BizzCore processes it solely on their behalf as a service
          provider.
        </p>
      </LegalSection>

      <LegalSection heading="3. Data Obtained from Meta Platforms (Facebook, Instagram, WhatsApp)">
        <p>
          When a business integrates its Facebook Page, Instagram Professional Account, or WhatsApp
          Business account with BizzCore, we access and process data provided through Meta APIs
          based on the explicit permissions granted by that business.
        </p>
        <p>
          <strong>Data Processed</strong> may include business account IDs, social profile
          information, messages, post comments, media uploads, lead form submissions, and
          interaction analytics, depending on enabled integrations.
        </p>
        <p>
          <strong>Purpose of Use:</strong> BizzCore uses Meta platform data strictly to provide
          user-requested features such as unified conversation management, lead tracking, automated
          messaging, content publishing, and business insights.
        </p>
        <p>
          <strong>Restrictions:</strong> BizzCore does not sell Meta platform data, share it with
          third parties for independent marketing, or use it to train generalized artificial
          intelligence models.
        </p>
      </LegalSection>

      <LegalSection heading="4. Data Isolation & Security">
        <p>
          <strong>Multi-Tenant Separation:</strong> every record in BizzCore is tied to a specific
          business; backend authentication and query filtering enforce data separation on every
          request to prevent unauthorized access across accounts.
        </p>
        <p>
          <strong>Encryption of Sensitive Fields:</strong> customer phone numbers and birthdates are
          encrypted at rest using AES-256-GCM and shown as masked values by default; viewing
          unmasked data requires a deliberate action that is rate-limited and logged.
        </p>
        <p>
          <strong>Connected Credentials:</strong> access tokens for third-party integrations
          (including WhatsApp and Meta APIs) are stored encrypted before being saved and are treated
          as write-only parameters.
        </p>
      </LegalSection>

      <LegalSection heading="5. Third-Party Data Sharing">
        <p>
          We do not sell customer or business data. Data is shared with third parties only: with
          Integration Providers explicitly connected by the business (such as Meta Platforms, Inc.
          for WhatsApp, Facebook, and Instagram functionality); with Infrastructure Services
          (hosting, database, and system infrastructure providers bound by confidentiality and
          security obligations); and for Legal Compliance, when required by valid legal process,
          subpoena, or enforceable governmental request.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data Retention">
        <p>
          We retain business account data and customer records for as long as the underlying
          BizzCore account remains active. Upon account termination or receipt of a valid deletion
          request, data is deleted or anonymized within 30 days, except where retention is required
          for legal, tax, or fraud-prevention obligations.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data Deletion & Account Closure">
        <p>
          <strong>BizzCore Account Deletion:</strong> a business may request permanent deletion of
          its account and associated data by emailing{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-maroon hover:underline">{SUPPORT_EMAIL}</a>{" "}
          or contacting support via our official channels.
        </p>
        <p>
          <strong>Disconnecting Meta Accounts:</strong> disconnecting a Facebook, Instagram, or
          WhatsApp integration from the BizzCore dashboard immediately stops further data retrieval
          from Meta APIs.
        </p>
        <p>
          <strong>User Data Deletion Requests:</strong> individual end-users seeking deletion of
          data held by a specific business operating on BizzCore may submit requests via{" "}
          <Link to="/data-deletion" className="text-maroon hover:underline">https://bizzcore.in/data-deletion</Link>{" "}
          or by contacting our support team directly.
        </p>
      </LegalSection>

      <LegalSection heading="8. Updates to This Policy">
        <p>
          We may update this policy periodically to reflect operational, legal, or regulatory
          changes. The revised version will be published on this page with an updated "Last
          Updated" date.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
