import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

// Local dev only — matches prisma/seed.ts's demo fixtures, which that
// script itself refuses to create against a production environment (see
// its assertNotProduction guard). import.meta.env.DEV is statically false
// in any production Vite build, so this whole block (including the box
// below) is dead-code-eliminated from what actually ships — not just
// hidden by a runtime check.
const DEMO_CREDENTIALS = import.meta.env.DEV
  ? [
      { label: "Super Admin", email: "platform-admin@kalericonsole.com", password: "SuperAdmin@123" },
      { label: "Kaleri Saree (Admin)", email: "owner@kalerisaree.com", password: "Kaleri@123" },
      {
        label: "Rangoli Threads (Admin — forces password change)",
        email: "owner@rangolithreads.com",
        password: "Rangoli@Temp123",
      },
    ]
  : [];

// Shared by pages/tenant/Login.tsx (the bare /login page, still the
// redirect target for an unauthenticated visit to any protected route) and
// pages/Landing.tsx (the public marketing page's embedded "central login
// box") — same form, same behavior, one place to fix.
export function SignInForm() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const current = await login(email, password);
      if (!current) {
        setError("Something went wrong. Please try again.");
        return;
      }
      if (current.mustChangePassword) {
        navigate("/change-password");
      } else if (current.role === "SUPER_ADMIN") {
        navigate("/super-admin", { state: { welcome: true } });
      } else {
        navigate("/dashboard", { state: { welcome: true, businessName: current.businessName } });
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 429) {
          setError("Too many attempts. Please wait a few minutes and try again.");
        } else {
          setError(err.response?.data?.error ?? "Invalid email or password.");
        }
      } else {
        setError("Invalid email or password.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(demoEmail: string, demoPassword: string) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError(null);
  }

  return (
    <div>
      <h2 className="font-serif text-2xl text-neutral-900">Sign in</h2>
      <p className="mt-1 text-sm text-neutral-500">Welcome back — enter your details below.</p>

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
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
              Password
            </label>
            <Link to="/forgot-password" className="text-xs font-medium text-maroon hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {import.meta.env.DEV && (
        <div className="mt-8 rounded-xl border border-neutral-200 bg-cream/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Demo credentials</p>
          <ul className="mt-2 space-y-2">
            {DEMO_CREDENTIALS.map((cred) => (
              <li key={cred.email}>
                <button
                  type="button"
                  onClick={() => fillDemo(cred.email, cred.password)}
                  className="w-full text-left text-xs text-neutral-600 hover:text-maroon"
                >
                  <span className="font-medium text-neutral-800">{cred.label}:</span> {cred.email} / {cred.password}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
