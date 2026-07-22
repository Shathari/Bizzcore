import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { resetPassword } from "../../api/auth";
import { AuthLayout } from "../../components/AuthLayout";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? "Could not reset your password.");
      } else {
        setError("Could not reset your password.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <h2 className="font-serif text-2xl text-neutral-900">Invalid reset link</h2>
        <p className="mt-3 text-sm text-neutral-600">
          This password reset link is missing its token. Request a new one from the sign-in page.
        </p>
        <Link to="/forgot-password" className="mt-8 inline-block text-sm font-medium text-maroon hover:underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <h2 className="font-serif text-2xl text-neutral-900">Password updated</h2>
        <p className="mt-3 text-sm text-neutral-600">Your password has been reset. You can now sign in.</p>
        <button
          onClick={() => navigate("/login")}
          className="mt-8 w-full rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
        >
          Go to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="font-serif text-2xl text-neutral-900">Set a new password</h2>
      <p className="mt-1 text-sm text-neutral-500">Choose a new password for your account.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-neutral-700">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral-700">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
          {submitting ? "Resetting…" : "Reset password"}
        </button>
      </form>
    </AuthLayout>
  );
}
