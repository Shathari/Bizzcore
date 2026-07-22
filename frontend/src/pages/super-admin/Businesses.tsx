import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Users, Clock, RotateCcw } from "lucide-react";
import { listBusinesses, updateBusinessStatus, restoreBusiness, type BusinessSummary } from "../../api/superAdmin";
import { useToast } from "../../components/Toast";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Active: "bg-emerald-100 text-emerald-700",
    Suspended: "bg-red-100 text-red-700",
    PendingSetup: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-neutral-100 text-neutral-700"
      }`}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Businesses() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const shownWelcome = useRef(false);

  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  async function load(deleted = showDeleted) {
    try {
      const data = await listBusinesses({ includeDeleted: deleted });
      setBusinesses(deleted ? data.filter((b) => b.deletedAt !== null) : data);
    } catch {
      setError("Could not load businesses.");
    }
  }

  useEffect(() => {
    setBusinesses(null);
    load(showDeleted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleted]);

  async function handleRestore(b: BusinessSummary) {
    setTogglingId(b.id);
    try {
      await restoreBusiness(b.id);
      await load(showDeleted);
      showToast(`${b.businessName} restored`);
    } catch {
      showToast("Could not restore business.", "error");
    } finally {
      setTogglingId(null);
    }
  }

  useEffect(() => {
    const state = location.state as { welcome?: boolean } | null;
    if (state?.welcome && !shownWelcome.current) {
      shownWelcome.current = true;
      showToast("Welcome back");
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate, showToast]);

  async function toggleStatus(b: BusinessSummary) {
    const nextStatus = b.status === "Suspended" ? "Active" : "Suspended";
    setTogglingId(b.id);
    try {
      await updateBusinessStatus(b.id, nextStatus);
      await load();
      showToast(`${b.businessName} ${nextStatus === "Suspended" ? "suspended" : "reactivated"}`);
    } catch {
      showToast("Could not update business status.", "error");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-neutral-900">Businesses</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {showDeleted ? "Deleted tenants — recoverable via Restore." : "Every tenant on BizzCore."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              showDeleted ? "border-maroon bg-maroon/5 text-maroon" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {showDeleted ? "Show active" : "Show deleted"}
          </button>
          <Link
            to="/super-admin/new"
            className="rounded-xl bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-maroon-dark"
          >
            + Add Business
          </Link>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-6 py-3">Business</th>
              <th className="px-6 py-3">Owner</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3">Customers</th>
              <th className="px-6 py-3">Last login</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {businesses === null && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-neutral-400">
                  Loading…
                </td>
              </tr>
            )}
            {businesses?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-neutral-400">
                  {showDeleted ? "No deleted businesses." : "No businesses yet."}
                </td>
              </tr>
            )}
            {businesses?.map((b) => (
              <tr key={b.id} className="hover:bg-neutral-50">
                <td className="px-6 py-4">
                  <Link
                    to={`/super-admin/businesses/${b.id}`}
                    className="font-medium text-neutral-900 hover:text-maroon"
                  >
                    {b.businessName}
                  </Link>
                  {b.websiteUrl && <p className="text-xs text-neutral-400">{b.websiteUrl}</p>}
                </td>
                <td className="px-6 py-4 text-neutral-600">
                  <p>{b.ownerEmail}</p>
                  {b.ownerPhone && <p className="text-xs text-neutral-400">{b.ownerPhone}</p>}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-6 py-4 text-neutral-600">{formatDate(b.createdAt)}</td>
                <td className="px-6 py-4 text-neutral-600">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {b.customerCount}
                  </span>
                </td>
                <td className="px-6 py-4 text-neutral-600">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDate(b.lastLogin)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {showDeleted ? (
                    <button
                      onClick={() => handleRestore(b)}
                      disabled={togglingId === b.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleStatus(b)}
                      disabled={togglingId === b.id}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                        b.status === "Suspended"
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-red-50 text-red-700 hover:bg-red-100"
                      }`}
                    >
                      {b.status === "Suspended" ? "Reactivate" : "Suspend"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
