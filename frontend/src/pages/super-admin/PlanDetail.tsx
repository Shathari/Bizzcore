import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { ArrowLeft } from "lucide-react";
import { getPlan, updatePlan, updatePlanFeature, type PlanWithFeatures, type PlanFeatureRow } from "../../api/superAdminPlans";
import { useToast } from "../../components/Toast";
import { CATEGORY_LABELS, groupByCategory } from "../../lib/planCategories";

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [plan, setPlan] = useState<PlanWithFeatures | null>(null);
  const [priceMonthly, setPriceMonthly] = useState("");
  const [priceYearly, setPriceYearly] = useState("");

  async function load() {
    if (!id) return;
    try {
      const p = await getPlan(id);
      setPlan(p);
      setPriceMonthly(String(p.priceMonthly));
      setPriceYearly(String(p.priceYearly));
    } catch {
      showToast("Could not load this plan.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function savePriceField(field: "priceMonthly" | "priceYearly", raw: string) {
    if (!plan) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      showToast("Enter a valid price.");
      if (field === "priceMonthly") setPriceMonthly(String(plan.priceMonthly));
      else setPriceYearly(String(plan.priceYearly));
      return;
    }
    if (value === plan[field]) return;
    try {
      const updated = await updatePlan(plan.id, { [field]: value });
      setPlan({ ...plan, priceMonthly: updated.priceMonthly, priceYearly: updated.priceYearly });
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save price.") : "Could not save price.");
      if (field === "priceMonthly") setPriceMonthly(String(plan.priceMonthly));
      else setPriceYearly(String(plan.priceYearly));
    }
  }

  async function toggleFlag(field: "isFeatured" | "isActive", value: boolean) {
    if (!plan) return;
    const previous = plan[field];
    setPlan({ ...plan, [field]: value });
    try {
      await updatePlan(plan.id, { [field]: value });
    } catch (err) {
      setPlan((p) => (p ? { ...p, [field]: previous } : p));
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save.") : "Could not save.");
    }
  }

  async function saveFeatureRow(featureKey: string, patch: { included?: boolean; value?: string | null }) {
    if (!plan) return;
    const row = plan.features.find((f) => f.featureKey === featureKey);
    if (!row) return;
    const nextIncluded = patch.included ?? row.included;
    const nextValue = patch.value !== undefined ? patch.value : row.value;
    const previousFeatures = plan.features;
    setPlan({
      ...plan,
      features: plan.features.map((f) => (f.featureKey === featureKey ? { ...f, included: nextIncluded, value: nextValue } : f)),
    });
    try {
      await updatePlanFeature(plan.id, featureKey, { included: nextIncluded, value: nextValue });
    } catch (err) {
      setPlan((p) => (p ? { ...p, features: previousFeatures } : p));
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save this feature.") : "Could not save this feature.");
    }
  }

  if (!plan) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm text-neutral-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="px-8 py-8">
      <Link to="/super-admin/plans" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-maroon">
        <ArrowLeft className="h-4 w-4" /> Back to Plans
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl text-neutral-900">{plan.name}</h1>
          {plan.description && <p className="mt-1 text-sm text-neutral-500">{plan.description}</p>}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={plan.isFeatured} onChange={(e) => toggleFlag("isFeatured", e.target.checked)} className="rounded border-neutral-300" />
            Most Popular badge
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={plan.isActive} onChange={(e) => toggleFlag("isActive", e.target.checked)} className="rounded border-neutral-300" />
            Active
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Monthly price (₹)</label>
          <input
            type="number"
            min={0}
            value={priceMonthly}
            onChange={(e) => setPriceMonthly(e.target.value)}
            onBlur={(e) => savePriceField("priceMonthly", e.target.value)}
            className="mt-1 w-40 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Yearly price (₹)</label>
          <input
            type="number"
            min={0}
            value={priceYearly}
            onChange={(e) => setPriceYearly(e.target.value)}
            onBlur={(e) => savePriceField("priceYearly", e.target.value)}
            className="mt-1 w-40 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
      </div>

      <p className="mt-6 text-xs text-neutral-400">
        Every change below saves immediately and applies to every business currently on this plan.
      </p>

      <div className="mt-2 space-y-6">
        {groupByCategory(plan.features).map(([category, rows]) => (
          <div key={category} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-neutral-800">{CATEGORY_LABELS[category] ?? category}</h2>
            </div>
            <div className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <FeatureRow key={row.featureKey} row={row} onSave={(patch) => saveFeatureRow(row.featureKey, patch)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureRow({ row, onSave }: { row: PlanFeatureRow; onSave: (patch: { included?: boolean; value?: string | null }) => void }) {
  const [valueDraft, setValueDraft] = useState(row.value ?? "");

  useEffect(() => {
    setValueDraft(row.value ?? "");
  }, [row.value]);

  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <label className="flex w-8 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={row.included}
          onChange={(e) => onSave({ included: e.target.checked })}
          className="rounded border-neutral-300"
        />
      </label>
      <div className="flex-1">
        <p className="text-sm text-neutral-800">{row.displayName}</p>
        <p className="text-xs text-neutral-400">
          {row.valueType}
          {row.unit ? ` · ${row.unit}` : ""}
        </p>
      </div>
      {row.valueType !== "BOOLEAN" && (
        <input
          type="text"
          value={valueDraft}
          disabled={!row.included}
          onChange={(e) => setValueDraft(e.target.value)}
          onBlur={() => {
            const next = valueDraft.trim() || null;
            if (next !== (row.value ?? null)) onSave({ value: next });
          }}
          placeholder={row.valueType === "NUMERIC" ? `e.g. 100 or unlimited` : "e.g. Basic"}
          className="w-40 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50 disabled:text-neutral-400 focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
      )}
    </div>
  );
}
