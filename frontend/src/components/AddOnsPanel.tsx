import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Plus, X } from "lucide-react";
import {
  listAddOnCatalog,
  listTenantAddOns,
  grantAddOn,
  cancelTenantAddOn,
  type AddOn,
  type TenantAddOn,
} from "../api/superAdminSubscriptions";
import { useToast } from "./Toast";
import { Button } from "./Button";
import { Modal } from "./Modal";

// Super-Admin-only: grant/cancel a tenant's add-ons. No real payment — a
// grant just records a TenantAddOn row (same mocked-billing pattern as the
// rest of subscriptions); a real Stripe/Razorpay integration can be
// dropped in later without changing this UI.
function formatPrice(addOn: AddOn): string {
  if (addOn.billingType === "OneTime") return `₹${addOn.priceOneTime?.toLocaleString("en-IN")} one-time`;
  return `₹${addOn.priceRecurring?.toLocaleString("en-IN")}/mo`;
}

function statusStyle(status: TenantAddOn["status"]): string {
  if (status === "Active") return "bg-emerald-50 text-emerald-700";
  if (status === "Cancelled") return "bg-neutral-100 text-neutral-500";
  return "bg-amber-50 text-amber-700";
}

export function AddOnsPanel({ tenantId }: { tenantId: string }) {
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState<AddOn[] | null>(null);
  const [tenantAddOns, setTenantAddOns] = useState<TenantAddOn[] | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [selectedAddOnId, setSelectedAddOnId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    try {
      const [c, t] = await Promise.all([listAddOnCatalog(), listTenantAddOns(tenantId)]);
      setCatalog(c);
      setTenantAddOns(t);
    } catch {
      showToast("Could not load add-ons.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function openGrant() {
    setSelectedAddOnId(catalog?.[0]?.id ?? "");
    setQuantity(1);
    setError(null);
    setGrantOpen(true);
  }

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    if (!selectedAddOnId) return;
    setGranting(true);
    setError(null);
    try {
      await grantAddOn(tenantId, selectedAddOnId, quantity);
      setGrantOpen(false);
      showToast("Add-on granted.");
      await load();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not grant add-on.") : "Could not grant add-on.");
    } finally {
      setGranting(false);
    }
  }

  async function handleCancel(tenantAddOnId: string) {
    setCancellingId(tenantAddOnId);
    try {
      await cancelTenantAddOn(tenantId, tenantAddOnId);
      showToast("Add-on cancelled.");
      await load();
    } catch {
      showToast("Could not cancel add-on.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">Add-ons</span>
        <button
          type="button"
          onClick={openGrant}
          className="flex items-center gap-1 rounded-lg border border-maroon/40 px-2 py-1 text-xs font-semibold text-maroon hover:bg-maroon/5"
        >
          <Plus className="h-3.5 w-3.5" /> Grant add-on
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {tenantAddOns === null && <p className="text-xs text-neutral-400">Loading…</p>}
        {tenantAddOns?.length === 0 && <p className="text-xs text-neutral-400">No add-ons granted yet.</p>}
        {tenantAddOns?.map((ta) => (
          <div key={ta.id} className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2 text-xs">
            <div>
              <span className="font-medium text-neutral-800">{ta.addOn.name}</span>
              {ta.quantity > 1 && <span className="text-neutral-500"> × {ta.quantity}</span>}
              <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 font-medium ${statusStyle(ta.status)}`}>{ta.status}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-neutral-400">{formatPrice(ta.addOn)}</span>
              {ta.status === "Active" && (
                <button
                  type="button"
                  onClick={() => handleCancel(ta.id)}
                  disabled={cancellingId === ta.id}
                  aria-label={`Cancel ${ta.addOn.name}`}
                  className="text-neutral-400 hover:text-red-600 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={grantOpen} onClose={() => setGrantOpen(false)} title="Grant add-on">
        <form onSubmit={handleGrant} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Add-on</label>
            <select
              value={selectedAddOnId}
              onChange={(e) => setSelectedAddOnId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              {catalog?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {formatPrice(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Quantity</label>
            <input
              type="number"
              min={1}
              required
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={granting || !selectedAddOnId}>
              {granting ? "Granting…" : "Grant"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
