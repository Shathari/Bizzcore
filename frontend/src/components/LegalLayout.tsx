import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import logo from "../assets/logo.png";

// Shared chrome for the public legal/status pages (Privacy, Terms,
// Security, Status) linked from Landing.tsx's footer — same brand palette
// as the landing page, cross-links between the four so a reader on one
// can reach the others without going back through the footer.
export function LegalLayout({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white font-sans">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="BizzCore" className="h-8 w-8" />
            <span className="font-serif text-lg text-maroon">BizzCore</span>
          </Link>
          <Link to="/" className="text-sm font-semibold text-neutral-600 transition hover:text-maroon">
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-serif text-3xl text-neutral-900">{title}</h1>
        {updated && <p className="mt-2 text-sm text-neutral-500">Last updated {updated}</p>}
        <div className="prose-legal mt-8 space-y-6 text-neutral-700">{children}</div>
      </main>

      <footer className="border-t border-neutral-200 bg-cream">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500">
          <span>© {new Date().getFullYear()} BizzCore</span>
          <nav className="flex flex-wrap gap-5">
            <Link to="/privacy" className="hover:text-maroon">Privacy</Link>
            <Link to="/terms" className="hover:text-maroon">Terms</Link>
            <Link to="/security" className="hover:text-maroon">Security</Link>
            <Link to="/status" className="hover:text-maroon">Status</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl text-neutral-900">{heading}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-neutral-600">{children}</div>
    </section>
  );
}
