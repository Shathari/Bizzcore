import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

// Shared shell for every logged-out auth page (Login, ForgotPassword,
// ResetPassword) — the maroon marketing panel + white card, so the three
// pages don't each duplicate this markup.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="md:w-1/2 bg-maroon text-cream flex flex-col justify-between px-10 py-12 md:px-16 md:py-20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-gold" />
          <span className="font-serif text-2xl tracking-wide">BizzCore</span>
        </div>

        <div>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight">
            The operating system <em className="text-gold">for your business</em>
          </h1>
          <p className="mt-6 max-w-md text-cream/80 text-lg">
            One console for customers, orders, your website, and social media —
            for <em className="text-gold">bigger, better businesses</em>.
          </p>
        </div>

        <p className="text-sm text-cream/60">BizzCore</p>
      </div>

      <div className="md:w-1/2 bg-white flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
