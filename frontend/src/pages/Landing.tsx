import { Sparkles, Users, Globe2, Share2, MessageCircle, Mail } from "lucide-react";
import { SignInForm } from "../components/SignInForm";

// Placeholder contact details — layout only, per the "show me the layout
// before wiring real contact links" instruction. Replace both once the
// real WhatsApp Business number and support inbox are confirmed.
const WHATSAPP_NUMBER = "919000000000"; // digits only, no "+", for the wa.me link
const WHATSAPP_MESSAGE = "Hi! I'd like to get started with BizzCore.";
const CONTACT_EMAIL = "hello@bizzcore.example";

const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const PITCH_POINTS = [
  { icon: Users, text: "Customers, orders, and follow-ups in one place" },
  { icon: Globe2, text: "Your website's content, synced from your own dashboard" },
  { icon: Share2, text: "Social media and WhatsApp, managed without switching tabs" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold" />
            <span className="font-serif text-xl text-maroon">BizzCore</span>
          </div>
          <a
            href="#sign-in"
            className="rounded-xl border border-maroon px-4 py-2 text-sm font-semibold text-maroon transition hover:bg-maroon/5"
          >
            Sign in
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col justify-center">
            <h1 className="font-serif text-4xl leading-tight text-neutral-900 md:text-5xl">
              The operating system <em className="text-maroon">for your business</em>
            </h1>
            <p className="mt-6 max-w-md text-lg text-neutral-600">
              One console for customers, your website, social media, and communication — built to run
              whatever kind of business you're growing.
            </p>
            <ul className="mt-8 space-y-3">
              {PITCH_POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-neutral-700">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-maroon/10 text-maroon">
                    <Icon className="h-4 w-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <a
              href="#get-started"
              className="mt-10 inline-flex w-fit items-center rounded-xl bg-maroon px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
            >
              Get started
            </a>
          </div>

          <div id="sign-in" className="scroll-mt-8 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
            <SignInForm />
          </div>
        </section>

        <section id="get-started" className="scroll-mt-8 border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16 text-center">
            <h2 className="font-serif text-3xl text-neutral-900">Get started</h2>
            <p className="mx-auto mt-3 max-w-xl text-neutral-600">
              Tell us about your business and we'll set up your console — no setup fee, no commitment.
            </p>
            <div className="mx-auto mt-10 grid max-w-2xl gap-6 sm:grid-cols-2">
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 p-8 transition hover:border-maroon/40 hover:bg-maroon/5"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <MessageCircle className="h-6 w-6" />
                </span>
                <span className="font-serif text-lg text-neutral-900">Chat on WhatsApp</span>
                <span className="text-sm text-neutral-500">Fastest way to reach us</span>
              </a>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 p-8 transition hover:border-maroon/40 hover:bg-maroon/5"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-maroon/10 text-maroon">
                  <Mail className="h-6 w-6" />
                </span>
                <span className="font-serif text-lg text-neutral-900">Email us</span>
                <span className="text-sm text-neutral-500">{CONTACT_EMAIL}</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-sm text-neutral-500">
          © {new Date().getFullYear()} BizzCore
        </div>
      </footer>
    </div>
  );
}
