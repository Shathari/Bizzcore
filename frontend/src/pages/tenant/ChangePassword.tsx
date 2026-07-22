import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import { Sparkles } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { changePassword } from "../../api/auth";
import { FullScreenSpinner } from "../../components/FullScreenSpinner";

export default function ChangePassword() {
  const { user, loading: authLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return <FullScreenSpinner />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  // Nothing forcing this screen — send them where they belong instead of
  // letting a stale bookmark/URL land here unnecessarily.
  if (!user.mustChangePassword) {
    return <Navigate to={user.role === "SUPER_ADMIN" ? "/super-admin" : "/"} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      const current = await refresh();
      if (current?.role === "SUPER_ADMIN") {
        navigate("/super-admin", { replace: true, state: { welcome: true } });
      } else {
        navigate("/dashboard", { replace: true, state: { welcome: true, businessName: current?.businessName } });
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? "Could not update password. Please try again.");
      } else {
        setError("Could not update password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" />
          <span className="font-serif text-xl text-maroon">BizzCore</span>
        </div>

        <h1 className="mt-6 font-serif text-2xl text-neutral-900">Set a new password</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {user.name ? `Welcome, ${user.name}. ` : ""}
          For security, choose a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <PasswordField
            id="currentPassword"
            label="Temporary password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            id="newPassword"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={8}
          />
          <PasswordField
            id="confirmPassword"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={8}
          />

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
            {submitting ? "Updating…" : "Set new password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
    </div>
  );
}
