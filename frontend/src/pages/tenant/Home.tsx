import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { MessageCircle, Eye, UserPlus, Clock, Phone, type LucideIcon } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { getDashboardSummary, type DashboardSummary } from "../../api/dashboard";
import { callCustomer } from "../../api/customers";

// How long a decrypted number stays visible before auto re-masking — same
// window as the Customers detail view's Reveal action (see Customers.tsx).
const CALL_DISPLAY_MS = 18_000;

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function Home() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const shownWelcome = useRef(false);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch(() => setError("Could not load dashboard."));
  }, []);

  useEffect(() => {
    const state = location.state as { welcome?: boolean; businessName?: string | null } | null;
    if (state?.welcome && !shownWelcome.current) {
      shownWelcome.current = true;
      showToast(`Welcome back to ${state.businessName ?? user?.businessName ?? "your business"}`);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate, showToast, user]);

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Home</h1>
      <p className="mt-1 text-sm text-neutral-500">Today's snapshot for {user?.businessName}.</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={MessageCircle} label="Today's Inquiries" value={summary?.todaysInquiries} />
        <StatCard icon={Eye} label="Website Visitors" value={summary?.websiteVisitorsToday} />
        <StatCard icon={UserPlus} label="New Customers" value={summary?.newCustomersToday} />
        <StatCard icon={Clock} label="Pending Follow-ups" value={summary?.pendingFollowUps} />
      </div>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Revenue trend</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary?.revenueTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Line type="monotone" dataKey="revenue" stroke="#7A1F2B" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Priority follow-ups</h2>
        <p className="mt-1 text-sm text-neutral-500">VIP and Bridal customers due for outreach.</p>
        <div className="mt-4 space-y-3">
          {summary?.priorityFollowUps.length === 0 && (
            <p className="text-sm text-neutral-400">Nothing needs attention right now.</p>
          )}
          {summary?.priorityFollowUps.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900">{c.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <FollowUpCallAction customerId={c.id} phoneMasked={c.phoneMasked} />
                  <span>· Last purchase: {formatDate(c.lastPurchase)}</span>
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  c.segment === "Bridal" ? "bg-gold/20 text-maroon" : "bg-maroon/10 text-maroon"
                }`}
              >
                {c.segment}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Decrypts a customer's phone on demand (POST /customers/:id/call, logged
// under AccessLog reason follow_up_call) and opens the device's dialer via
// a tel: link. The number stays visible briefly so staff can dial manually
// if tel: isn't handled, then auto re-masks — never left showing forever.
function FollowUpCallAction({ customerId, phoneMasked }: { customerId: string; phoneMasked: string }) {
  const { showToast } = useToast();
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCall() {
    setLoading(true);
    try {
      const phone = await callCustomer(customerId);
      setRevealedPhone(phone);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRevealedPhone(null), CALL_DISPLAY_MS);
      window.location.href = `tel:${phone}`;
    } catch (err) {
      showToast(
        axios.isAxiosError(err) && err.response?.status === 429
          ? "Too many reveals — wait a moment and try again."
          : "Could not retrieve this number.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      {revealedPhone ?? phoneMasked}
      <button
        type="button"
        onClick={handleCall}
        disabled={loading}
        className="text-neutral-400 hover:text-maroon disabled:opacity-50"
        aria-label="Reveal number and call this customer"
        title="Reveal number and call"
      >
        <Phone className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value?: number }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-maroon/10 text-maroon">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
          <p className="text-xl font-semibold text-neutral-900">{value ?? "—"}</p>
        </div>
      </div>
    </Card>
  );
}
