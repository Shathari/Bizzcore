import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  createBusiness,
  resendCredentials,
  type CreateBusinessResponse,
  type DeliveryChannelResult,
} from "../../api/superAdmin";
import { useToast } from "../../components/Toast";

export default function AddBusiness() {
  const { showToast } = useToast();
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateBusinessResponse | null>(null);
  const [resending, setResending] = useState(false);

  function handleLogoChange(file: File | null) {
    setLogo(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await createBusiness({
        businessName,
        websiteUrl: websiteUrl || undefined,
        ownerName,
        ownerEmail,
        ownerPhone: ownerPhone || undefined,
        logo: logo ?? undefined,
      });
      setResult(res);
      showToast(`${res.tenant.businessName} created`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? "Could not create business.");
      } else {
        setError("Could not create business.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!result) return;
    setResending(true);
    try {
      const res = await resendCredentials(result.tenant.id);
      setResult({ ...result, delivery: res.delivery });
      showToast("Credentials resent");
    } catch {
      showToast("Could not resend credentials.", "error");
    } finally {
      setResending(false);
    }
  }

  function resetForm() {
    setBusinessName("");
    setWebsiteUrl("");
    setOwnerName("");
    setOwnerEmail("");
    setOwnerPhone("");
    handleLogoChange(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="font-serif text-2xl text-neutral-900">Add Business</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Creates the tenant and its first admin account, and sends login credentials.
      </p>

      {!result && (
        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <Field label="Business name" value={businessName} onChange={setBusinessName} required />
          <Field label="Website URL" value={websiteUrl} onChange={setWebsiteUrl} type="url" placeholder="https://" />
          <Field label="Owner name" value={ownerName} onChange={setOwnerName} required />
          <Field label="Owner email" value={ownerEmail} onChange={setOwnerEmail} type="email" required />
          <Field label="Owner phone" value={ownerPhone} onChange={setOwnerPhone} type="tel" placeholder="+91…" />

          <div>
            <label className="block text-sm font-medium text-neutral-700">Business cover / logo</label>
            <p className="text-xs text-neutral-400">
              Shown as the Business Admin's dashboard avatar throughout their dashboard.
            </p>
            <div className="mt-1 flex items-center gap-3">
              {logoPreview && (
                <img src={logoPreview} alt="" className="h-12 w-12 rounded-full object-cover border border-neutral-200" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
                className="block flex-1 text-sm text-neutral-600 file:mr-4 file:rounded-lg file:border-0 file:bg-maroon file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-maroon-dark"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create business"}
          </button>
        </form>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="flex items-center gap-2 text-emerald-800">
              {result.tenant.logoUrl && (
                <img src={result.tenant.logoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              )}
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-medium">{result.tenant.businessName} created</p>
            </div>
            <p className="mt-2 text-sm text-emerald-700">
              Admin account: {result.admin.name} ({result.admin.email})
            </p>
            <DeliveryStatusLine channel="Email" res={result.delivery.email} />
            {result.delivery.sms && <DeliveryStatusLine channel="SMS" res={result.delivery.sms} />}
          </div>

          {result.delivery.fallback && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                <p className="font-medium">Delivery didn't complete — share these manually</p>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-neutral-500">Login URL</dt>
                  <dd className="font-mono text-neutral-800">{result.delivery.fallback.loginUrl}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-neutral-500">Temporary password</dt>
                  <dd className="flex items-center gap-2 font-mono text-neutral-800">
                    {result.delivery.fallback.tempPassword}
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(result.delivery.fallback!.tempPassword);
                        showToast("Password copied");
                      }}
                      className="text-neutral-400 hover:text-maroon"
                      aria-label="Copy password"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="mt-4 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                {resending ? "Resending…" : "Resend credentials"}
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <Link
              to={`/super-admin/businesses/${result.tenant.id}`}
              className="rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
            >
              View business
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Add another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryStatusLine({ channel, res }: { channel: string; res: DeliveryChannelResult }) {
  return (
    <p className="mt-1 text-sm text-emerald-700">
      {channel}:{" "}
      {res.delivered
        ? "delivered"
        : res.mode === "mock"
          ? "mock mode (not configured)"
          : `failed${res.error ? ` — ${res.error}` : ""}`}
    </p>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">{label}</label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
    </div>
  );
}
