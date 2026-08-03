import { Link } from "react-router-dom";
import {
  Users,
  MessageCircle,
  Mail,
  Sparkles,
  ShieldCheck,
  Eye,
  UserPlus,
  Clock,
  Check,
  type LucideIcon,
} from "lucide-react";
import logo from "../assets/logo.png";

// BizzCore's own public marketing site — same maroon/cream/gold theme as
// the tenant dashboard and Super Admin console, so the brand reads as one
// consistent product across the public site and the app itself.
//
// No self-serve signup exists yet — onboarding is Super-Admin-provisioned
// after a WhatsApp/email conversation, and there is no free trial. Every
// "Get Started" CTA here routes to the on-page contact section, not a
// signup form. Existing Admins/Super Admins reach their real sign-in page
// via the "Log in" link.

const WHATSAPP_NUMBER = "919762098549"; // digits only, no "+", for the wa.me link
const WHATSAPP_DISPLAY = "+91 97620 98549";
const CONTACT_EMAIL = "support@bizzcore.in";

function waHref(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Users,
    title: "Unified Customer & Website Management",
    description: "Customer records, orders, and your website's content stay in sync from one dashboard — no separate CMS logins.",
  },
  {
    icon: Sparkles,
    title: "AI Content Generation",
    description: "Captions, blog posts, product descriptions, and SEO content, generated for your business in seconds.",
  },
  {
    icon: MessageCircle,
    title: "Multi-Channel Communication",
    description: "WhatsApp, email, and SMS in one inbox, tied to each customer's history and follow-ups.",
  },
  {
    icon: ShieldCheck,
    title: "Role-Based Multi-Tenant Access",
    description: "Every business's data is kept completely separate, with Super Admin oversight only when you need it.",
  },
];

// Mirrors backend/prisma/seedPlans.ts's PLAN_DEFS + a few representative
// FEATURE_ROWS cells for each tier — a static snapshot for the first design
// pass. Once the layout/copy/colors are approved, this gets replaced by a
// fetch from a new public plans endpoint so it can never drift from the
// real Plan/PlanFeature data the tenant Subscription page reads.
const PRICING_TIERS = [
  {
    name: "Starter AI",
    priceMonthly: 999,
    featured: false,
    highlights: ["100 AI content generations/mo", "2 connected social accounts", "200 WhatsApp messages/mo", "1 team member"],
  },
  {
    name: "Business Website",
    priceMonthly: 2499,
    featured: true,
    highlights: ["500 AI content generations/mo", "Website included (Basic)", "5 connected accounts", "3 team members"],
  },
  {
    name: "Business Growth",
    priceMonthly: 5999,
    featured: false,
    highlights: ["2,000 AI content generations/mo", "Dynamic website + blog module", "15 connected accounts", "10 team members"],
  },
  {
    name: "Enterprise",
    priceMonthly: 14999,
    featured: false,
    highlights: ["Unlimited AI content generation", "Premium website + advanced SEO", "Unlimited connected accounts", "Dedicated success manager"],
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-cream font-sans">
      <SiteHeader />
      <Hero />
      <About />
      <Capabilities />
      <Pricing />
      <Contact />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <img src={logo} alt="BizzCore" className="h-9 w-9" />
          <span className="font-serif text-xl text-maroon">BizzCore</span>
        </div>

        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-600 md:flex">
          <a href="#capabilities" className="transition hover:text-maroon">Features</a>
          <a href="#pricing" className="transition hover:text-maroon">Pricing</a>
          <a href="#about" className="transition hover:text-maroon">About</a>
          <a href="#contact" className="transition hover:text-maroon">Contact</a>
        </nav>

        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-semibold text-neutral-600 transition hover:text-maroon">
            Log in
          </Link>
          <a
            href="#contact"
            className="rounded-xl bg-maroon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
          >
            Get Started
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
        <div>
          <span className="inline-flex items-center rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-maroon-dark">
            Multi-tenant Business OS
          </span>
          <h1 className="mt-5 font-serif text-4xl leading-tight text-neutral-900 md:text-5xl">
            The OS <em className="text-maroon">your business</em> runs on
          </h1>
          <p className="mt-6 max-w-md text-lg text-neutral-600">
            Customers, your website, social media, AI content, and every conversation — one console
            instead of five disconnected tools.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href="#contact"
              className="inline-flex items-center rounded-xl bg-maroon px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
            >
              Get Started
            </a>
            <a
              href={waHref("I want to know more about BizzCore")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-6 py-3 text-sm font-semibold text-neutral-700 transition hover:border-gold hover:text-maroon-dark"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-6 py-3 text-sm font-semibold text-neutral-700 transition hover:border-maroon hover:text-maroon"
            >
              <Mail className="h-4 w-4" />
              Email Us
            </a>
          </div>
        </div>

        <DashboardPreview />
      </div>
    </section>
  );
}

// A stylized (not fabricated) preview of the real tenant Home dashboard —
// same 4 stat cards and revenue trend chart as pages/tenant/Home.tsx, with
// representative sample numbers instead of live data.
function DashboardPreview() {
  const stats: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: MessageCircle, label: "Today's Inquiries", value: "12" },
    { icon: Eye, label: "Website Visitors", value: "148" },
    { icon: UserPlus, label: "New Customers", value: "6" },
    { icon: Clock, label: "Pending Follow-ups", value: "4" },
  ];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-2xl">
      <div className="flex items-center gap-1.5 rounded-t-2xl border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        <span className="ml-3 rounded-md bg-white px-3 py-1 text-xs text-neutral-400">app.bizzcore.in/dashboard</span>
      </div>

      <div className="bg-cream p-5">
        <p className="font-serif text-sm text-neutral-900">Home</p>
        <p className="text-xs text-neutral-500">Today's snapshot</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {stats.map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-maroon/10 text-maroon">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-neutral-400">{label}</p>
              <p className="text-base font-semibold text-neutral-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium text-neutral-900">Revenue trend</p>
          <svg viewBox="0 0 200 56" className="mt-2 h-14 w-full" preserveAspectRatio="none">
            <polyline
              points="0,44 25,38 50,40 75,28 100,32 125,20 150,24 175,10 200,14"
              fill="none"
              stroke="#7A1F2B"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function About() {
  return (
    <section id="about" className="scroll-mt-16 border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="font-serif text-3xl text-neutral-900">Built for real businesses</h2>
        <p className="mt-4 text-lg text-neutral-600">
          BizzCore is a multi-tenant business OS: each business gets its own console for managing
          customers, running its website, publishing on social media, and talking to customers — with
          AI doing the repetitive content work in between. No stitching together five separate tools.
        </p>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="capabilities" className="scroll-mt-16 border-t border-neutral-200 bg-cream">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-serif text-3xl text-neutral-900">Everything your business runs on</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-2xl border border-neutral-200 bg-white p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-maroon/10 text-maroon">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-serif text-lg text-neutral-900">{title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-16 border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h2 className="font-serif text-3xl text-neutral-900">Simple, transparent pricing</h2>
          <p className="mx-auto mt-3 max-w-xl text-neutral-600">
            Every tier includes a real dashboard, not a stripped-down demo. Onboarding is set up for
            you — tell us which plan fits and we'll take it from there.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl border p-6 ${
                tier.featured ? "border-maroon shadow-xl ring-1 ring-maroon" : "border-neutral-200"
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-maroon-dark">
                  Most Popular
                </span>
              )}
              <h3 className="font-serif text-lg text-neutral-900">{tier.name}</h3>
              <p className="mt-3">
                <span className="text-3xl font-semibold text-neutral-900">₹{tier.priceMonthly.toLocaleString("en-IN")}</span>
                <span className="text-sm text-neutral-500">/mo</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {tier.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-sm text-neutral-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    {h}
                  </li>
                ))}
              </ul>
              <a
                href={waHref(`I'm interested in the ${tier.name} plan`)}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-6 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  tier.featured
                    ? "bg-maroon text-white hover:bg-maroon-dark"
                    : "border border-neutral-300 text-neutral-700 hover:border-maroon hover:text-maroon"
                }`}
              >
                Get Started
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="scroll-mt-16 border-t border-neutral-200 bg-cream">
      <div className="mx-auto max-w-6xl px-6 py-16 text-center">
        <h2 className="font-serif text-3xl text-neutral-900">Get in touch</h2>
        <p className="mx-auto mt-3 max-w-xl text-neutral-600">
          BizzCore isn't self-serve sign-up — tell us about your business on WhatsApp or email, and
          we'll set up your console. No setup fee, no commitment.
        </p>
        <div className="mx-auto mt-10 grid max-w-2xl gap-6 sm:grid-cols-2">
          <a
            href={waHref("I want to join BizzCore")}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-8 transition hover:border-gold hover:shadow-md"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/15 text-maroon-dark">
              <MessageCircle className="h-6 w-6" />
            </span>
            <span className="font-serif text-lg text-neutral-900">Chat on WhatsApp</span>
            <span className="text-sm text-neutral-500">{WHATSAPP_DISPLAY}</span>
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-8 transition hover:border-maroon/40 hover:shadow-md"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-maroon/10 text-maroon">
              <Mail className="h-6 w-6" />
            </span>
            <span className="font-serif text-lg text-neutral-900">Email us</span>
            <span className="text-sm text-neutral-500">{CONTACT_EMAIL}</span>
          </a>
        </div>
        <a
          href={waHref("I want to join BizzCore")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 inline-flex items-center rounded-xl bg-maroon px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
        >
          Talk to us
        </a>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-maroon-dark">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src={logo} alt="BizzCore" className="h-7 w-7" />
            <span className="font-serif text-white">BizzCore</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-white/70">
            <Link to="/privacy" className="transition hover:text-gold">Privacy</Link>
            <Link to="/terms" className="transition hover:text-gold">Terms</Link>
            <Link to="/security" className="transition hover:text-gold">Security</Link>
            <Link to="/status" className="transition hover:text-gold">Status</Link>
          </nav>
        </div>
        <p className="mt-6 text-center text-sm text-white/50 sm:text-left">
          © {new Date().getFullYear()} BizzCore. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
