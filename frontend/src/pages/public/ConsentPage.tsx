import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { getConsentPageInfo, submitConsentChoice } from "../../api/publicConsent";

// Public, unauthenticated — the destination of a QR code printed at a
// tenant's checkout counter (see Settings.tsx's "Consent link" section for
// where the link/QR is generated). No login, no session, nothing beyond the
// token in the URL — see backend's routes/publicConsent.ts for the trust
// model this mirrors.
export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"OPTED_IN" | "OPTED_OUT" | null>(null);

  useEffect(() => {
    if (!token) {
      setNotFound(true);
      return;
    }
    getConsentPageInfo(token).then((info) => {
      if (!info) setNotFound(true);
      else setBusinessName(info.businessName);
    });
  }, [token]);

  async function handleSubmit(choice: "YES" | "NO", e?: FormEvent) {
    e?.preventDefault();
    if (!token || !phone.trim()) {
      setError("Enter your phone number first.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const status = await submitConsentChoice(token, phone.trim(), choice);
      setResult(status);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <PageShell>
        <p className="text-center text-neutral-500">This link isn't valid.</p>
      </PageShell>
    );
  }

  if (result) {
    return (
      <PageShell businessName={businessName}>
        <p className="text-center text-neutral-700">
          {result === "OPTED_IN"
            ? "Thanks! You're all set to receive updates via WhatsApp."
            : "Got it — you won't receive marketing messages from us."}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell businessName={businessName}>
      <form onSubmit={(e) => handleSubmit("YES", e)} className="space-y-4">
        <p className="text-center text-neutral-700">
          Would you like to receive updates about our latest collections and offers via WhatsApp?
        </p>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Your phone number</label>
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98000 00000"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Submitting…" : "Yes, keep me updated"}
          </Button>
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => handleSubmit("NO")} className="flex-1">
            No, thanks
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

function PageShell({ businessName, children }: { businessName?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-center font-serif text-xl text-neutral-900">{businessName ?? "BizzCore"}</h1>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
