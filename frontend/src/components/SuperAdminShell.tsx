import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, PlusCircle, ScrollText, LogOut, Sparkles, Wrench, CreditCard } from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Reuses the tenant app's palette/fonts but is structurally distinct — a
// dark, full-bleed sidebar rather than the tenant shell's cream sidebar
// with a maroon active pill — so Super Admin never reads as "just another
// tenant". Never mixed into the tenant shell/nav.
//
// No global "Feature Catalog" entry — since the tenant-scoping migration,
// a Feature Catalog is a specific business's own independent copy, not a
// single global list; it's reached from that business's own Business
// Detail page instead (see BusinessDetail.tsx).
const NAV_ITEMS = [
  { to: "/super-admin", label: "Businesses", icon: Building2, end: true },
  { to: "/super-admin/new", label: "Add Business", icon: PlusCircle, end: false },
  { to: "/super-admin/plans", label: "Plans", icon: CreditCard, end: false },
  { to: "/super-admin/custom-development", label: "Custom Development", icon: Wrench, end: false },
  { to: "/super-admin/audit-log", label: "Audit Log", icon: ScrollText, end: false },
];

export function SuperAdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-neutral-50">
      <aside className="w-64 shrink-0 bg-maroon-dark text-cream flex flex-col">
        <div className="flex items-center gap-2 px-6 py-6">
          <Sparkles className="h-5 w-5 text-gold" />
          <div>
            <p className="font-serif text-lg leading-none">BizzCore</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-cream/60">Control Tower</p>
          </div>
        </div>

        <nav className="mt-4 flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-gold text-maroon-dark" : "text-cream/80 hover:bg-white/10"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-cream/60">{user?.email}</p>
          <button
            onClick={() => logout().then(() => navigate("/login"))}
            className="mt-3 flex items-center gap-2 text-sm text-cream/80 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
