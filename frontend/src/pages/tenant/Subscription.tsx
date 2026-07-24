import { Fragment, useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  listAvailableAddOns,
  listMyAddOns,
  listServiceTypes,
  listMyCustomDevelopmentRequests,
  submitCustomDevelopmentRequest,
  getMyPlan,
  listComparablePlans,
  type AddOn,
  type TenantAddOn,
  type ServiceTypeInfo,
  type ServiceType,
  type CustomDevelopmentRequest,
  type RequestStatus,
  type MyPlan,
  type MeteredFeatureKey,
} from "../../api/subscription";
import { startCheckout, listMyInvoices, type BillingCycle, type Invoice } from "../../api/billing";
import { loadRazorpayCheckoutScript, openRazorpayCheckout } from "../../lib/razorpay";
import type { PlanWithFeatures } from "../../api/superAdminPlans";
import { CATEGORY_LABELS, groupByCategory } from "../../lib/planCategories";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

// Plan details + usage-vs-limits + a read-only plan comparison, plus the
// add-on catalog + this tenant's own add-ons, and the Custom Development
// request/quote queue. Self-serve add-on purchase waits for real billing;
// for now, add-ons are granted by Super Admin (see AddOnsPanel.tsx) — the
// add-ons section here is read-only, same as plan changes (see
// routes/subscription.ts's file comment on why that stays a Super Admin
// action). Custom Development IS a real tenant-initiated action (a
// request, not a checkout).

const METERED_LABELS: Record<MeteredFeatureKey, string> = {
  AI_CONTENT_GENERATION: "AI Content Generation",
  WHATSAPP_MESSAGES: "WhatsApp Messages",
  SCHEDULED_POSTS: "Scheduled Posts",
};

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

function formatFeatureValue(row: { valueType: string; included: boolean; value: number | "unlimited" | string | null; unit: string | null }): string {
  if (!row.included) return "Not included";
  if (row.valueType === "BOOLEAN") return "Included";
  if (row.value === "unlimited") return "Unlimited";
  if (row.value === null) return "Included";
  return row.unit ? `${row.value} ${row.unit}` : String(row.value);
}

function formatPrice(addOn: AddOn): string {
  if (addOn.billingType === "OneTime") return `₹${addOn.priceOneTime?.toLocaleString("en-IN")} one-time`;
  return `₹${addOn.priceRecurring?.toLocaleString("en-IN")}/mo`;
}

function addOnStatusStyle(status: TenantAddOn["status"]): string {
  if (status === "Active") return "bg-emerald-50 text-emerald-700";
  if (status === "Cancelled") return "bg-neutral-100 text-neutral-500";
  return "bg-amber-50 text-amber-700";
}

function requestStatusStyle(status: RequestStatus): string {
  if (status === "Requested") return "bg-neutral-100 text-neutral-600";
  if (status === "Quoted") return "bg-amber-50 text-amber-700";
  if (status === "Approved" || status === "InProgress") return "bg-blue-50 text-blue-700";
  if (status === "Completed" || status === "Invoiced") return "bg-emerald-50 text-emerald-700";
  return "bg-red-50 text-red-700"; // Cancelled
}

function invoiceStatusStyle(status: Invoice["status"]): string {
  if (status === "Paid") return "bg-emerald-50 text-emerald-700";
  if (status === "Created") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700"; // Failed | Cancelled
}

function invoiceStatusLabel(status: Invoice["status"]): string {
  // "Created" means the Razorpay order exists but no webhook has confirmed
  // payment yet — see routes/billing.ts's file comment on why the client-
  // side checkout callback alone never flips this.
  return status === "Created" ? "Awaiting confirmation" : status;
}

export default function Subscription() {
  const { showToast } = useToast();
  const [myPlan, setMyPlan] = useState<MyPlan | null>(null);
  const [comparablePlans, setComparablePlans] = useState<PlanWithFeatures[] | null>(null);
  const [showFeatureGrid, setShowFeatureGrid] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [myAddOns, setMyAddOns] = useState<TenantAddOn[] | null>(null);
  const [catalog, setCatalog] = useState<AddOn[] | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeInfo[] | null>(null);
  const [myRequests, setMyRequests] = useState<CustomDevelopmentRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("Monthly");
  const [checkingOutPlanId, setCheckingOutPlanId] = useState<string | null>(null);

  async function loadRequests() {
    setMyRequests(await listMyCustomDevelopmentRequests());
  }

  async function loadInvoices() {
    try {
      setInvoices(await listMyInvoices());
    } catch {
      showToast("Could not load billing history.", "error");
    }
  }

  useEffect(() => {
    Promise.all([listMyAddOns(), listAvailableAddOns(), listServiceTypes(), listMyCustomDevelopmentRequests(), getMyPlan(), listComparablePlans()])
      .then(([mine, available, types, requests, plan, plans]) => {
        setMyAddOns(mine);
        setCatalog(available);
        setServiceTypes(types);
        setMyRequests(requests);
        setMyPlan(plan);
        setComparablePlans(plans);
        if (types.length > 0) setServiceType(types[0].key);
      })
      .catch(() => setError("Could not load subscription details."));
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePay(plan: PlanWithFeatures) {
    setCheckingOutPlanId(plan.id);
    try {
      await loadRazorpayCheckoutScript();
      const session = await startCheckout(plan.id, billingCycle);
      openRazorpayCheckout(
        {
          key: session.keyId,
          amount: session.amount,
          currency: session.currency,
          order_id: session.orderId,
          name: "BizzCore",
          description: `${session.plan.name} — ${session.billingCycle}`,
          prefill: { name: session.prefill.name, email: session.prefill.email, contact: session.prefill.contact },
          theme: { color: "#7A1F2B" },
          handler: () => {
            // Checkout completing here is only a UI signal — it is NOT
            // proof of payment (that could be spoofed client-side). The
            // Invoice stays "Created"/Pending until Razorpay's
            // signature-verified webhook confirms it server-to-server.
            showToast("Payment submitted — we're confirming it now. This can take a few seconds.");
            loadInvoices();
          },
          modal: {
            ondismiss: () => setCheckingOutPlanId(null),
          },
        },
        (message) => showToast(message, "error")
      );
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not start checkout.") : "Could not start checkout.", "error");
    } finally {
      setCheckingOutPlanId(null);
    }
  }

  const activeAddOnIds = new Set((myAddOns ?? []).filter((a) => a.status === "Active").map((a) => a.addOnId));
  const selectedInfo = serviceTypes?.find((s) => s.key === serviceType);

  async function handleSubmitRequest(e: FormEvent) {
    e.preventDefault();
    if (!serviceType) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await submitCustomDevelopmentRequest(serviceType, description);
      setDescription("");
      showToast("Request submitted — we'll follow up with a quote.");
      await loadRequests();
    } catch (err) {
      setFormError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not submit request.") : "Could not submit request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Subscription</h1>
      <p className="mt-1 text-sm text-neutral-500">Your plan's add-ons — talk to your account manager to add more.</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <Card className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-neutral-900">Your plan</h2>
            {myPlan === null ? (
              <p className="mt-1 text-sm text-neutral-400">Loading…</p>
            ) : myPlan.plan === null ? (
              <p className="mt-1 text-sm text-neutral-500">No plan assigned yet — contact your account manager.</p>
            ) : (
              <p className="mt-1 text-sm text-neutral-500">
                {myPlan.plan.name} · ₹{myPlan.plan.priceMonthly.toLocaleString("en-IN")}/mo
              </p>
            )}
          </div>
          {myPlan?.plan && (
            <div className="text-right">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(myPlan.subscriptionStatus)}`}>
                {myPlan.subscriptionStatus}
              </span>
              <p className="mt-1 text-xs text-neutral-400">
                {formatDate(myPlan.currentPeriodStart)} – {formatDate(myPlan.currentPeriodEnd)}
              </p>
            </div>
          )}
        </div>

        {myPlan && (
          <div className="mt-5 space-y-3">
            {(Object.keys(METERED_LABELS) as MeteredFeatureKey[]).map((key) => {
              const usage = myPlan.usage[key];
              const pct =
                usage.included && typeof usage.limit === "number" && usage.limit > 0
                  ? Math.min(100, Math.round((usage.used / usage.limit) * 100))
                  : usage.included
                    ? 0
                    : null;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-700">{METERED_LABELS[key]}</span>
                    <span className="text-neutral-500">
                      {!usage.included ? "Not included" : usage.limit === "unlimited" ? `${usage.used} used · unlimited` : `${usage.used} / ${usage.limit}`}
                    </span>
                  </div>
                  {pct !== null && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowFeatureGrid((v) => !v)}
          className="mt-5 flex items-center gap-1 text-xs font-semibold text-maroon hover:underline"
        >
          {showFeatureGrid ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showFeatureGrid ? "Hide full feature list" : "Show full feature list"}
        </button>

        {showFeatureGrid && myPlan && (
          <div className="mt-4 space-y-5">
            {groupByCategory(myPlan.features).map(([category, rows]) => (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{CATEGORY_LABELS[category] ?? category}</h3>
                <div className="mt-1.5 divide-y divide-neutral-100">
                  {rows.map((row) => (
                    <div key={row.featureKey} className="flex items-center justify-between py-1.5 text-sm">
                      <span className={row.included ? "text-neutral-800" : "text-neutral-400"}>{row.displayName}</span>
                      <span className={row.included ? "text-neutral-600" : "text-neutral-400"}>{formatFeatureValue(row)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-neutral-900">Change your plan</h2>
            <p className="mt-1 text-sm text-neutral-500">Pick a plan and pay securely with Razorpay — cards, UPI, netbanking, and wallets.</p>
          </div>
          <div className="flex rounded-xl border border-neutral-200 p-1">
            {(["Monthly", "Yearly"] as BillingCycle[]).map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  billingCycle === cycle ? "bg-maroon text-white" : "text-neutral-600 hover:text-maroon"
                }`}
              >
                {cycle}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comparablePlans === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {comparablePlans?.map((p) => {
            const isCurrent = p.id === myPlan?.plan?.id;
            const price = billingCycle === "Monthly" ? p.priceMonthly : p.priceYearly;
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-4 ${isCurrent ? "border-maroon bg-maroon/5" : "border-neutral-200"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-serif text-base text-neutral-900">{p.name}</p>
                  {p.isFeatured && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maroon">Popular</span>}
                </div>
                {p.description && <p className="mt-1 text-xs text-neutral-500">{p.description}</p>}
                <p className="mt-3 text-lg font-semibold text-neutral-900">
                  ₹{price.toLocaleString("en-IN")}
                  <span className="text-xs font-normal text-neutral-500">{billingCycle === "Monthly" ? "/mo" : "/yr"}</span>
                </p>
                <div className="mt-4">
                  {isCurrent ? (
                    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Current plan</span>
                  ) : (
                    <Button className="w-full" disabled={checkingOutPlanId === p.id} onClick={() => handlePay(p)}>
                      {checkingOutPlanId === p.id ? "Opening checkout…" : `Pay ₹${price.toLocaleString("en-IN")}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Billing history</h2>
        <p className="mt-1 text-sm text-neutral-500">Every checkout you've started, and its confirmed status.</p>
        <div className="mt-4 space-y-2">
          {invoices === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {invoices?.length === 0 && <p className="text-sm text-neutral-400">No payments yet.</p>}
          {invoices?.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {inv.plan.name} <span className="text-neutral-500">· {inv.billingCycle}</span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  ₹{inv.amount.toLocaleString("en-IN")} · {formatDate(inv.createdAt)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${invoiceStatusStyle(inv.status)}`}>
                {invoiceStatusLabel(inv.status)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <button type="button" onClick={() => setShowCompare((v) => !v)} className="flex w-full items-center justify-between text-left">
          <div>
            <h2 className="font-serif text-lg text-neutral-900">Compare plans</h2>
            <p className="mt-1 text-sm text-neutral-500">See what a different plan would include. Contact your account manager to switch.</p>
          </div>
          {showCompare ? <ChevronUp className="h-5 w-5 text-neutral-400" /> : <ChevronDown className="h-5 w-5 text-neutral-400" />}
        </button>

        {showCompare && comparablePlans && (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Feature</th>
                  {comparablePlans.map((p) => (
                    <th
                      key={p.id}
                      className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide ${
                        p.id === myPlan?.plan?.id ? "text-maroon" : "text-neutral-500"
                      }`}
                    >
                      {p.name}
                      {p.id === myPlan?.plan?.id && " (yours)"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupByCategory(comparablePlans[0]?.features ?? []).map(([category, rows]) => (
                  <Fragment key={category}>
                    <tr>
                      <td colSpan={comparablePlans.length + 1} className="bg-neutral-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {CATEGORY_LABELS[category] ?? category}
                      </td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.featureKey} className="border-b border-neutral-100">
                        <td className="px-3 py-1.5 text-neutral-700">{row.displayName}</td>
                        {comparablePlans.map((p) => {
                          const cell = p.features.find((f) => f.featureKey === row.featureKey);
                          return (
                            <td key={p.id} className={`px-3 py-1.5 ${p.id === myPlan?.plan?.id ? "font-medium text-neutral-900" : "text-neutral-500"}`}>
                              {cell ? formatFeatureValue(cell) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Your add-ons</h2>
        <div className="mt-4 space-y-2">
          {myAddOns === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {myAddOns?.length === 0 && <p className="text-sm text-neutral-400">No add-ons on your account yet.</p>}
          {myAddOns?.map((ta) => (
            <div key={ta.id} className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {ta.addOn.name}
                  {ta.quantity > 1 && <span className="text-neutral-500"> × {ta.quantity}</span>}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatPrice(ta.addOn)}
                  {ta.renewsAt && ta.status === "Active" && ` · renews ${new Date(ta.renewsAt).toLocaleDateString()}`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${addOnStatusStyle(ta.status)}`}>{ta.status}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Available add-ons</h2>
        <p className="mt-1 text-sm text-neutral-500">Contact your account manager to add any of these to your plan.</p>
        <div className="mt-4 space-y-2">
          {catalog === null && <p className="text-sm text-neutral-400">Loading…</p>}
          {catalog?.map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-neutral-900">{a.name}</p>
                {a.description && <p className="mt-0.5 text-xs text-neutral-500">{a.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-600">{formatPrice(a)}</span>
                {activeAddOnIds.has(a.id) && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="font-serif text-lg text-neutral-900">Request custom work</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Need something beyond your plan or the add-ons above? Tell us what you need — this is a request, we'll follow up
          with a quote before any work or billing happens.
        </p>
        <form onSubmit={handleSubmitRequest} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Type of work</label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as ServiceType)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              {serviceTypes?.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {selectedInfo && <p className="mt-1 text-xs text-neutral-400">Typical range: {selectedInfo.priceRange} — reference only, not a quote.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Description</label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you need built or changed…"
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>
          {formError && (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !serviceType}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>

        {myRequests !== null && myRequests.length > 0 && (
          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Your requests</p>
            <div className="mt-2 space-y-2">
              {myRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {serviceTypes?.find((s) => s.key === r.serviceType)?.label ?? r.serviceType}
                    </p>
                    <p className="mt-0.5 max-w-md truncate text-xs text-neutral-500">{r.description}</p>
                    {r.quotedAmount !== null && (
                      <p className="mt-0.5 text-xs text-neutral-600">Quoted: ₹{r.quotedAmount.toLocaleString("en-IN")}</p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${requestStatusStyle(r.status)}`}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
