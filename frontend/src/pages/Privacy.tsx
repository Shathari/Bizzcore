import { LegalLayout, LegalSection } from "../components/LegalLayout";

// Good-faith description of how BizzCore actually handles data today,
// written from the real implementation (tenant scoping in
// middleware/resolveTenant.ts, AES-256-GCM field encryption in
// lib/piiCrypto.ts, AccessLog/AuditLog models) — not a lawyer-reviewed
// final policy. See the closing note below and the disclaimer at the
// bottom of this file before treating this as binding.
export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="29 July 2026">
      <p>
        BizzCore is the console businesses use to run their customers, website, and communication.
        This page describes, in plain language, what data we handle and how — based on how the
        product is actually built, not generic boilerplate.
      </p>

      <LegalSection heading="Whose data this covers">
        <p>
          Two kinds of data pass through BizzCore: the account data of the business itself (an
          admin's name, email, login), and the customer data a business chooses to store about its
          own customers (names, phone numbers, order history, notes). The customer data belongs to
          the business using BizzCore — we process it on their behalf, we don't use it for our own
          purposes.
        </p>
      </LegalSection>

      <LegalSection heading="Each business's data is kept separate">
        <p>
          Every record in BizzCore — customers, conversations, website content, everything — is tied
          to the specific business it belongs to, and every request our servers handle is scoped to
          the business the logged-in user actually belongs to. The system is built so that one
          business's staff cannot see or query another business's data through the product. This is
          enforced in our backend on every request, not left as a client-side check.
        </p>
      </LegalSection>

      <LegalSection heading="Sensitive customer fields are encrypted">
        <p>
          Customer phone numbers and birthdates are stored encrypted (AES-256-GCM), not as plain
          text, and are not included in ordinary list or detail views — staff see a masked version
          (e.g. <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">+9198••••••75</code>) by
          default. Viewing the real number requires a deliberate "reveal" action, which is
          rate-limited and recorded in an access log (who viewed it, when, and why — e.g. a follow-up
          call or a CSV export). Other customer fields such as name, email, and notes are not
          encrypted, since a business needs to search and display them in normal day-to-day use.
        </p>
      </LegalSection>

      <LegalSection heading="Credentials for connected services">
        <p>
          If a business connects a third-party account (for example, a WhatsApp Business number), the
          access token is encrypted before it's stored and is treated as write-only afterwards — our
          own dashboard shows only whether a credential is connected, never the credential itself.
        </p>
      </LegalSection>

      <LegalSection heading="What we don't do">
        <p>
          We don't sell customer data, and we don't use a business's customer data to advertise to
          them, train models for other customers, or share it with anyone outside the business
          without their instruction.
        </p>
      </LegalSection>

      <LegalSection heading="Exporting or deleting your data">
        <p>
          A business can export its own customer list at any time from its dashboard. Closing a
          BizzCore account and removing its data isn't yet a self-service action — email or WhatsApp
          us and our team will handle it, either as a recoverable deactivation or a permanent deletion
          if that's what you want.
        </p>
      </LegalSection>

      <p className="border-t border-slate-100 pt-6 text-sm text-slate-500">
        This is a good-faith, plain-language description of how BizzCore is actually built and
        operated as of the date above — it is not a final, legally-drafted policy and hasn't yet been
        reviewed by counsel. It describes what the product is designed to do, not a guarantee against
        every possible failure. If anything here should be more precise or you have questions, reach
        us via the contact details on our homepage.
      </p>
    </LegalLayout>
  );
}
