import { NavLink } from "react-router-dom";
import { Home, Users, MessageSquare, Globe, Share2, Wand2, CreditCard, Settings as SettingsIcon, Sparkles, CalendarCheck, X } from "lucide-react";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/dashboard/customers", label: "Customers", icon: Users, end: false },
  { to: "/dashboard/booking-requests", label: "Booking Requests", icon: CalendarCheck, end: false },
  { to: "/dashboard/communication", label: "Communication", icon: MessageSquare, end: false },
  { to: "/dashboard/website", label: "Website", icon: Globe, end: false },
  { to: "/dashboard/social-media", label: "Social Media", icon: Share2, end: false },
  { to: "/dashboard/ai-assistant", label: "AI Assistant", icon: Wand2, end: false },
  { to: "/dashboard/subscription", label: "Subscription", icon: CreditCard, end: false },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon, end: false },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-4 flex-1 space-y-1 px-3">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive ? "bg-maroon text-white" : "text-neutral-700 hover:bg-maroon/5"
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

// Static desktop sidebar — hidden below md, where TopBar's hamburger +
// MobileNavDrawer below take over instead of this being squeezed into a
// narrow column.
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-neutral-200 bg-cream md:flex">
      <div className="flex items-center gap-2 px-6 py-6">
        <Sparkles className="h-5 w-5 text-gold" />
        <span className="font-serif text-xl text-maroon">BizzCore</span>
      </div>
      <NavList />
    </aside>
  );
}

// Mobile-only slide-in drawer, opened via TopBar's hamburger button — same
// nav items/behavior as Sidebar above, just a different presentation for
// narrow viewports. Always mounted (not conditionally rendered) so the
// slide transition can play in both directions; aria-hidden + the
// off-screen transform keep it out of the tab order while closed.
export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col bg-cream shadow-xl transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold" />
            <span className="font-serif text-xl text-maroon">BizzCore</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-maroon" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <NavList onNavigate={onClose} />
      </aside>
    </>
  );
}
