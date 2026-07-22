import { NavLink } from "react-router-dom";
import { Home, Users, MessageSquare, Globe, Share2, Wand2, CreditCard, Settings as SettingsIcon, Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/dashboard/customers", label: "Customers", icon: Users, end: false },
  { to: "/dashboard/communication", label: "Communication", icon: MessageSquare, end: false },
  { to: "/dashboard/website", label: "Website", icon: Globe, end: false },
  { to: "/dashboard/social-media", label: "Social Media", icon: Share2, end: false },
  { to: "/dashboard/ai-assistant", label: "AI Assistant", icon: Wand2, end: false },
  { to: "/dashboard/subscription", label: "Subscription", icon: CreditCard, end: false },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon, end: false },
];

export function Sidebar() {
  return (
    <aside className="w-64 shrink-0 bg-cream border-r border-neutral-200 flex flex-col">
      <div className="flex items-center gap-2 px-6 py-6">
        <Sparkles className="h-5 w-5 text-gold" />
        <span className="font-serif text-xl text-maroon">BizzCore</span>
      </div>

      <nav className="mt-4 flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
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
    </aside>
  );
}
