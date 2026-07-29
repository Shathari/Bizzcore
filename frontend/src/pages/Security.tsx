import { LegalLayout, LegalSection } from "../components/LegalLayout";

// Same standard as Privacy.tsx — describes real, implemented mechanisms
// only (see backend middleware/resolveTenant.ts, lib/piiCrypto.ts,
// lib/accessLog.ts, routes/auth.ts, lib/roles.ts). Nothing here claims a
// third-party audit or certification, since none has been performed.
export default function Security() {
  return (
    <LegalLayout title="Security" updated="29 July 2026">
      <p>
        This page describes the security practices actually built into BizzCore today. It's a
        good-faith technical summary, not a certification — we haven't undergone a formal third-party
        security audit yet.
      </p>

      <LegalSection heading="Tenant isolation">
        <p>
          Every business's data is scoped to that business on every server request, based on the
          logged-in user's session — never taken from a URL or client-supplied value a user could
          tamper with. A suspended or removed business is blocked from access immediately, even if
          someone is still holding a valid login session.
        </p>
      </LegalSection>

      <LegalSection heading="Encryption">
        <p>
          Sensitive customer fields (phone numbers, birthdates) and any credentials for connected
          third-party services are encrypted at rest using AES-256-GCM before they reach the
          database. Passwords are never stored directly — only a bcrypt hash of each password is
          kept, so we can verify a login without ever holding the password itself.
        </p>
      </LegalSection>

      <LegalSection heading="Access logging">
        <p>
          Revealing a customer's real phone number or birthdate is a deliberate, rate-limited action
          that's recorded — who did it, when, and why (a follow-up call, a manual reveal, an export).
          Sensitive platform actions taken by our own team on a business's account (suspending,
          restoring, deleting) are similarly recorded in an audit trail.
        </p>
      </LegalSection>

      <LegalSection heading="Authentication">
        <p>
          Sessions use a signed, httpOnly session token that isn't readable by page scripts. Login and
          password-reset attempts are rate-limited to slow down brute-force attempts, and password
          reset links are single-use and expire quickly.
        </p>
      </LegalSection>

      <LegalSection heading="Access levels">
        <p>
          There are two access levels in BizzCore today: a Business Admin, who can only ever see and
          act on their own business's data, and a BizzCore Super Admin, who manages the platform
          itself (provisioning businesses, plans, and support). Both are enforced on our servers, not
          just hidden in the interface.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting a concern">
        <p>
          If you believe you've found a security issue in BizzCore, please tell us directly via the
          contact details on our homepage rather than testing it against a live business's data — we
          take reports seriously and will follow up.
        </p>
      </LegalSection>

      <p className="border-t border-slate-100 pt-6 text-sm text-slate-500">
        This describes practices we've actually implemented as of the date above, in plain language.
        It's not a guarantee that no security issue can ever occur, and it hasn't been reviewed by an
        independent auditor.
      </p>
    </LegalLayout>
  );
}
