import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { X } from "lucide-react";
import {
  listPlans,
  assignTenantPlan,
  listTenantOverrides,
  listTenantEntitlements,
  setTenantOverride,
  removeTenantOverride,
  type PlanWithFeatures,
  type TenantFeatureOverride,
  type EffectiveEntitlementRow,
} from "../api/superAdminPlans";
import { useToast } from "./Toast";
import { Button } from "./Button";
import { Modal } from "./Modal";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusStyle(status: string): string {
  if (status === "Active") return "bg-emerald-50 text-emerald-700";
  if (status === "Trialing") return "bg-blue-50 text-blue-700";
  if (status === "PastDue") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700"; // Cancelled
}

export function PlanAssignmentPanel({
  tenantId,
  currentPlanId,
  currentPlanName,
  subscriptionStatus,
  currentPeriodStart,
  currentPeriodEnd,
  onChanged,
}: {
  tenantId: string;
  currentPlanId: string | null;
  currentPlanName: string | null;
  subscriptionStatus: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [plans, setPlans] = useState<PlanWithFeatures[] | null>(null);
  const [overrides, setOverrides] = useState<TenantFeatureOverride[] | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlanId ?? "");
  const [assigning, setAssigning] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  async function loadOverrides() {
    try {
      setOverrides(await listTenantOverrides(tenantId));
    } catch {
      showToast("Could not load feature overrides.");
    }
  }

  useEffect(() => {
    listPlans()
      .then(setPlans)
      .catch(() => showToast("Could not load plans."));
    loadOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    setSelectedPlanId(currentPlanId ?? "");
  }, [currentPlanId]);

  async function handleAssign() {
    setAssigning(true);
    try {
      await assignTenantPlan(tenantId, { planId: selectedPlanId || null });
      showToast(selectedPlanId ? "Plan updated." : "Plan unassigned.");
      onChanged();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not change plan.") : "Could not change plan.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemoveOverride(featureKey: string) {
    setRemovingKey(featureKey);
    try {
      await removeTenantOverride(tenantId, featureKey);
      await loadOverrides();
      showToast("Override removed.");
    } catch {
      showToast("Could not remove override.");
    } finally {
      setRemovingKey(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Current plan</p>
          <p className="mt-1 text-sm font-medium text-neutral-900">{currentPlanName ?? "No plan assigned"}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Status</p>
          <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(subscriptionStatus)}`}>{subscriptionStatus}</span>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Current period</p>
          <p className="mt-1 text-sm text-neutral-600">
            {formatDate(currentPeriodStart)} – {formatDate(currentPeriodEnd)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Change plan</label>
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            className="mt-1 w-56 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            <option value="">No plan</option>
            {plans?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={handleAssign} disabled={assigning || selectedPlanId === (currentPlanId ?? "")}>
          {assigning ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Feature overrides</h3>
        <button type="button" onClick={() => setOverrideModalOpen(true)} className="text-xs font-semibold text-maroon hover:underline">
          + Add override
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-400">Per-tenant exceptions above or below the plan's own value — e.g. a one-off VIP concession.</p>

      <div className="mt-3">
        {overrides === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : overrides.length === 0 ? (
          <p className="text-sm text-neutral-400">No overrides — this tenant gets exactly what their plan includes.</p>
        ) : (
          <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {overrides.map((o) => (
              <div key={o.featureKey} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm text-neutral-800">{o.displayName}</p>
                  <p className="text-xs text-neutral-400">
                    {o.included === false ? "Excluded" : o.included === true ? "Included" : "Inherits plan"}
                    {o.value ? ` · ${o.value}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveOverride(o.featureKey)}
                  disabled={removingKey === o.featureKey}
                  aria-label={`Remove override for ${o.displayName}`}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {overrideModalOpen && (
        <AddOverrideModal
          tenantId={tenantId}
          onClose={() => setOverrideModalOpen(false)}
          onSaved={async () => {
            setOverrideModalOpen(false);
            await loadOverrides();
          }}
        />
      )}
    </div>
  );
}

function AddOverrideModal({ tenantId, onClose, onSaved }: { tenantId: string; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const [entitlements, setEntitlements] = useState<EffectiveEntitlementRow[] | null>(null);
  const [featureKey, setFeatureKey] = useState("");
  const [included, setIncluded] = useState<"inherit" | "true" | "false">("true");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTenantEntitlements(tenantId)
      .then((rows) => {
        setEntitlements(rows);
        if (rows.length > 0) setFeatureKey(rows[0].featureKey);
      })
      .catch(() => showToast("Could not load the feature list."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const selected = entitlements?.find((e) => e.featureKey === featureKey);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setTenantOverride(tenantId, {
        featureKey,
        included: included === "inherit" ? null : included === "true",
        value: selected?.valueType === "BOOLEAN" ? null : value.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save override.") : "Could not save override.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add feature override">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Feature</label>
          <select
            value={featureKey}
            onChange={(e) => setFeatureKey(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {entitlements?.map((e) => (
              <option key={e.featureKey} value={e.featureKey}>
                {e.displayName} — currently {e.included ? (e.value ?? "included") : "not included"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Included</label>
          <select
            value={included}
            onChange={(e) => setIncluded(e.target.value as "inherit" | "true" | "false")}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            <option value="true">Yes — force included</option>
            <option value="false">No — force excluded</option>
            <option value="inherit">Inherit from plan</option>
          </select>
        </div>

        {selected && selected.valueType !== "BOOLEAN" && (
          <div>
            <label className="block text-sm font-medium text-neutral-700">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={selected.valueType === "NUMERIC" ? "e.g. 500 or unlimited" : "e.g. Advanced"}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !featureKey}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
