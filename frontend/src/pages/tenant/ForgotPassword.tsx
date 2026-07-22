import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { forgotPassword } from "../../api/auth";
import { AuthLayout } from "../../components/AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        // Any other failure still shows the same confirmation as success —
        // the backend never distinguishes "no such account" from "sent",
        // and neither should this page.
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <h2 className="font-serif text-2xl text-neutral-900">Check your email</h2>
        <p className="mt-3 text-sm text-neutral-600">
          If an account exists for <span className="font-medium">{email}</span>, we've sent a link to
          reset your password. It expires in an hour.
        </p>
        <Link to="/login" className="mt-8 inline-block text-sm font-medium text-maroon hover:underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="font-serif text-2xl text-neutral-900">Forgot your password?</h2>
      <p className="mt-1 text-sm text-neutral-500">Enter your email and we'll send you a link to reset it.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <Link to="/login" className="mt-8 inline-block text-sm font-medium text-maroon hover:underline">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
