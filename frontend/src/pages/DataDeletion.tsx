import { useState } from "react";
import { LegalLayout, LegalSection } from "../components/LegalLayout";

const SUPPORT_EMAIL = "support@bizzcore.in";

// Minimal, self-service entry point for the "User Data Deletion Requests"
// path referenced from Privacy.tsx section 7. This is deliberately simple:
// it has no backend of its own — it composes a pre-filled email to support
// so a real person can identify the business involved and action the
// request. If a self-serve/API-backed flow is built later, this page is
// the natural place to wire it in.
export default function DataDeletion() {
  const [businessName, setBusinessName] = useState("");
  const [yourName, setYourName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [details, setDetails] = useState("");

  const subject = "Data Deletion Request";
  const body = [
    `Business on BizzCore this data was held by: ${businessName || "[fill in]"}`,
    `Your name: ${yourName || "[fill in]"}`,
    `Your contact info (email or phone used with that business): ${contactInfo || "[fill in]"}`,
    "",
    "What you'd like deleted:",
    details || "[describe the data you want deleted]",
  ].join("\n");

  const mailtoHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <LegalLayout title="Data Deletion Request" updated="29 July 2026">
      <p>
        If you're a customer or contact of a business that uses BizzCore, and you'd like your data
        deleted from that business's account, use this page to send us a request. We'll forward it
        to the business and confirm once it's actioned.
      </p>

      <LegalSection heading="Before you submit">
        <p>
          BizzCore doesn't own the customer data stored by the businesses on our platform — the
          business does. We can help route your request and prompt the business, but the underlying
          data belongs to them. If you know the business directly, contacting them is often the
          fastest path.
        </p>
      </LegalSection>

      <LegalSection heading="Send a request">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = mailtoHref;
          }}
        >
          <div>
            <label className="block text-sm font-medium text-neutral-700" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="The business whose BizzCore account holds your data"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-neutral-900 focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700" htmlFor="yourName">
              Your name
            </label>
            <input
              id="yourName"
              type="text"
              required
              value={yourName}
              onChange={(e) => setYourName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-neutral-900 focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700" htmlFor="contactInfo">
              Your email or phone number (as known to the business)
            </label>
            <input
              id="contactInfo"
              type="text"
              required
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-neutral-900 focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700" htmlFor="details">
              What would you like deleted?
            </label>
            <textarea
              id="details"
              rows={4}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. all my data, or specific records"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-neutral-900 focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>

          <button
            type="submit"
            className="rounded-md bg-maroon px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Send request via email
          </button>
          <p className="text-sm text-neutral-500">
            This opens your email app with a pre-filled message to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-maroon hover:underline">{SUPPORT_EMAIL}</a>.
            Nothing is sent until you press send there.
          </p>
        </form>
      </LegalSection>

      <LegalSection heading="Prefer email directly?">
        <p>
          You can skip the form and email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-maroon hover:underline">{SUPPORT_EMAIL}</a>{" "}
          directly with the business name, your name, your contact info, and what you'd like
          deleted.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
