import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Copy, Globe2, RotateCcw, AlertTriangle } from "lucide-react";
import {
  getBusinessDetail,
  resendCredentials,
  updateBusinessStatus,
  updateBusiness,
  deleteBusiness,
  restoreBusiness,
  type BusinessDetail as BusinessDetailType,
  type DeliveryResult,
} from "../../api/superAdmin";
import {
  listWebsiteIntegrations,
  listSchemaHistory,
  listConnectorAccessLog,
  listWebsiteContentModules,
  listWebsiteContentItems,
  createWebsiteContentItem,
  updateWebsiteContentItem,
  deleteWebsiteContentItem,
  importWebsiteContentItems,
  syncWebsiteContentItems,
  uploadWebsiteContentImage,
} from "../../api/superAdminWebsite";
import { useToast } from "../../components/Toast";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/Button";
import { ConnectionHealthPanel } from "../../components/ConnectionHealthPanel";
import { WebsiteContentManager } from "../../components/WebsiteContentManager";
import { AddOnsPanel } from "../../components/AddOnsPanel";
import { PlanAssignmentPanel } from "../../components/PlanAssignmentPanel";
import { auditActionLabel, auditDetailsSummary } from "../../lib/auditLog";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// A full Business Management console: Super Admin can edit every tenant
// field, manage status, regenerate credentials, and delete (soft or
// permanent) — all from here, no DB/env access needed. Website Integration
// settings (further down) were already fully editable from this page
// before this console existed; this only adds tenant-identity editing and
// the Business Actions/Danger Zone around it.
export default function BusinessDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<BusinessDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastDelivery, setLastDelivery] = useState<DeliveryResult | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const data = await getBusinessDetail(id);
      setDetail(data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setError("Business not found.");
      } else {
        setError("Could not load business.");
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function toggleStatus() {
    if (!detail) return;
    const nextStatus = detail.tenant.status === "Suspended" ? "Active" : "Suspended";
    setBusy(true);
    try {
      await updateBusinessStatus(detail.tenant.id, nextStatus);
      await load();
      showToast(`${detail.tenant.businessName} ${nextStatus === "Suspended" ? "suspended" : "reactivated"}`);
    } catch {
      showToast("Could not update status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await resendCredentials(detail.tenant.id);
      setLastDelivery(res.delivery);
      await load();
      showToast("Credentials resent");
    } catch {
      showToast("Could not resend credentials.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!detail) return;
    setBusy(true);
    try {
      await restoreBusiness(detail.tenant.id);
      await load();
      showToast(`${detail.tenant.businessName} restored`);
    } catch {
      showToast("Could not restore business.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!detail || !id) {
    return <div className="px-8 py-8 text-neutral-400">Loading…</div>;
  }

  const { tenant, users, stats, auditLog } = detail;
  const primaryAdmin = users.find((u) => u.role === "ADMIN") ?? null;
  const isDeleted = Boolean(tenant.deletedAt);

  return (
    <div className="px-8 py-8 max-w-3xl">
      <button
        onClick={() => navigate("/super-admin")}
        className="flex items-center gap-1 text-sm text-neutral-500 hover:text-maroon"
      >
        <ArrowLeft className="h-4 w-4" /> Back to businesses
      </button>

      <div className="mt-4 flex items-center gap-3">
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover border border-neutral-200" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-maroon/10 font-serif text-lg text-maroon">
            {tenant.businessName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="font-serif text-2xl text-neutral-900">{tenant.businessName}</h1>
          <p className="mt-1 text-sm text-neutral-500">{tenant.websiteUrl ?? "No website on file"}</p>
        </div>
      </div>

      {isDeleted && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            Deleted on {formatDateTime(tenant.deletedAt)} — hidden from the dashboard and can't log in, but its
            data is preserved.
          </p>
          <Button onClick={handleRestore} disabled={busy} variant="secondary">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore
          </Button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-3 gap-4">
        <StatCard label="Status" value={isDeleted ? "Deleted" : tenant.status} />
        <StatCard label="Customers" value={String(stats.customerCount)} />
        <StatCard label="Created" value={formatDateTime(tenant.createdAt)} />
      </div>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Business details</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Edit any field below and save — changes apply immediately.
        </p>
        <BusinessDetailsForm
          key={tenant.updatedAt}
          tenant={tenant}
          ownerName={primaryAdmin?.name ?? ""}
          disabled={isDeleted}
          onSaved={load}
        />
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Admin users</h2>
        <div className="mt-4 space-y-3">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900">{u.name}</p>
                <p className="text-xs text-neutral-500">
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ""}
                </p>
                <p className="text-xs text-neutral-400">Last login: {formatDateTime(u.lastLoginAt)}</p>
              </div>
              {u.mustChangePassword && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Password change pending
                </span>
              )}
            </div>
          ))}
        </div>

        {lastDelivery?.fallback && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-amber-800">Delivery didn't complete — share manually</p>
            <p className="mt-2 flex items-center gap-2 font-mono text-amber-900">
              {lastDelivery.fallback.tempPassword}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(lastDelivery.fallback!.tempPassword);
                  showToast("Password copied");
                }}
                className="text-amber-600 hover:text-amber-900"
                aria-label="Copy password"
              >
                <Copy className="h-4 w-4" />
              </button>
            </p>
            <p className="mt-1 text-amber-700">{lastDelivery.fallback.loginUrl}</p>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-neutral-400" />
            <h2 className="font-serif text-lg text-neutral-900">Website content &amp; integrations</h2>
          </div>
          <Link
            to={`/super-admin/businesses/${id}/feature-catalog`}
            className="text-sm font-medium text-maroon hover:underline"
          >
            Manage feature catalog
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          The tenant's own Admin configures their connector (base URL, authentication, field mapping) from
          their Settings page — this is a read-only view of its current health and history. You can still
          view and edit content directly below, as support/ops access. This business's own field schema
          (which fields Products/Blogs/etc. have) is a fully independent copy, managed via "Manage feature
          catalog" above — editing it can never affect any other business.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-neutral-700">Connection health</h3>
        <div className="mt-2">
          <ConnectionHealthPanel
            api={{
              list: () => listWebsiteIntegrations(id),
              schemaHistory: (featureKey) => listSchemaHistory(id, featureKey),
              accessLog: (featureKey) => listConnectorAccessLog(id, featureKey),
            }}
          />
        </div>

        <h3 className="mt-8 text-sm font-semibold text-neutral-700">Content</h3>
        <WebsiteContentManager
          listModules={() => listWebsiteContentModules(id)}
          forceManage
          emptyMessage="No content modules configured yet — the tenant Admin sets up their connector from their own Settings page."
          buildApi={(featureKey) => ({
            list: (options) => listWebsiteContentItems(id, featureKey, options),
            create: (payload) => createWebsiteContentItem(id, featureKey, payload),
            update: (itemId, payload) => updateWebsiteContentItem(id, featureKey, itemId, payload),
            remove: (itemId) => deleteWebsiteContentItem(id, featureKey, itemId),
            importItems: (filters) => importWebsiteContentItems(id, featureKey, filters),
            syncItems: () => syncWebsiteContentItems(id, featureKey),
            uploadImage: (file) => uploadWebsiteContentImage(id, file),
          })}
        />
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Subscription plan</h2>
        <p className="mt-1 text-sm text-neutral-500">Assign or change this business's plan, and manage per-tenant feature overrides.</p>
        <div className="mt-4">
          <PlanAssignmentPanel
            tenantId={id}
            currentPlanId={detail.tenant.planId}
            currentPlanName={detail.tenant.plan?.name ?? null}
            subscriptionStatus={detail.tenant.subscriptionStatus}
            currentPeriodStart={detail.tenant.currentPeriodStart}
            currentPeriodEnd={detail.tenant.currentPeriodEnd}
            onChanged={load}
          />
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Subscription add-ons</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Grant this business an add-on manually — no real payment yet, same mocked pattern as the rest of subscriptions.
        </p>
        <div className="mt-4">
          <AddOnsPanel tenantId={id} />
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Business Actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleResend} disabled={busy || isDeleted}>
            Regenerate admin credentials
          </Button>
          <Button
            variant="secondary"
            onClick={toggleStatus}
            disabled={busy || isDeleted}
            className={tenant.status === "Suspended" ? "" : "!border-red-200 !text-red-700 hover:!bg-red-50"}
          >
            {tenant.status === "Suspended" ? "Reactivate business" : "Suspend business"}
          </Button>
        </div>

        <div className="mt-6 rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-2 text-red-800">
            <AlertTriangle className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Danger zone</h3>
          </div>
          <p className="mt-1 text-xs text-red-700">
            Deleting a business is a serious action. Soft delete is recoverable; permanent delete is not.
          </p>
          <Button
            variant="danger"
            className="mt-3"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={busy}
          >
            Delete business…
          </Button>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-lg text-neutral-900">Recent activity</h2>
        <div className="mt-4 space-y-3">
          {auditLog.length === 0 && <p className="text-sm text-neutral-400">No activity yet.</p>}
          {auditLog.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="text-neutral-800">{auditActionLabel(entry.action)}</p>
                {auditDetailsSummary(entry.details) && (
                  <p className="text-xs text-neutral-400">{auditDetailsSummary(entry.details)}</p>
                )}
                <p className="text-xs text-neutral-400">by {entry.actor}</p>
              </div>
              <p className="text-xs text-neutral-400">{formatDateTime(entry.createdAt)}</p>
            </div>
          ))}
        </div>
      </section>

      {deleteDialogOpen && (
        <DeleteBusinessDialog
          tenant={tenant}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={() => {
            showToast(`${tenant.businessName} deleted`);
            navigate("/super-admin");
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function BusinessDetailsForm({
  tenant,
  ownerName,
  disabled,
  onSaved,
}: {
  tenant: BusinessDetailType["tenant"];
  ownerName: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [businessName, setBusinessName] = useState(tenant.businessName);
  const [websiteUrl, setWebsiteUrl] = useState(tenant.websiteUrl ?? "");
  const [customDomain, setCustomDomain] = useState(tenant.customDomain ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [name, setName] = useState(ownerName);
  const [ownerEmail, setOwnerEmail] = useState(tenant.ownerEmail);
  const [ownerPhone, setOwnerPhone] = useState(tenant.ownerPhone ?? "");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleLogoChange(file: File | null) {
    setLogo(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateBusiness(tenant.id, {
        businessName,
        websiteUrl,
        customDomain,
        address,
        ownerName: name,
        ownerEmail,
        ownerPhone,
        logo: logo ?? undefined,
      });
      showToast("Business details saved");
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save changes.") : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Business name" value={businessName} onChange={setBusinessName} required />
          <Field label="Website base URL" value={websiteUrl} onChange={setWebsiteUrl} type="url" placeholder="https://" />
          <Field label="Custom domain" value={customDomain} onChange={setCustomDomain} placeholder="shop.example.com" />
          <Field label="Owner name" value={name} onChange={setName} required />
          <Field label="Owner email" value={ownerEmail} onChange={setOwnerEmail} type="email" required />
          <Field label="Owner phone" value={ownerPhone} onChange={setOwnerPhone} type="tel" placeholder="+91…" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Address</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Logo</label>
          <div className="mt-1 flex items-center gap-3">
            <img
              src={logoPreview ?? tenant.logoUrl ?? undefined}
              alt=""
              className={`h-12 w-12 rounded-full object-cover border border-neutral-200 ${logoPreview || tenant.logoUrl ? "" : "hidden"}`}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
              className="block flex-1 text-sm text-neutral-600 file:mr-4 file:rounded-lg file:border-0 file:bg-maroon file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-maroon-dark"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </fieldset>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">{label}</label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
    </div>
  );
}

// Two-step, server-re-validated confirmation for an irreversible action:
// step 1 states what's about to happen and lets Super Admin choose Soft
// (default, recoverable) vs Permanent; step 2 requires typing the business
// name (or the literal "DELETE") before the button enables. The backend
// (routes/super-admin.ts) re-checks this same confirmation text itself —
// this dialog is a UX gate, not the actual safety boundary.
function DeleteBusinessDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: BusinessDetailType["tenant"];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [permanent, setPermanent] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmText.trim() === tenant.businessName || confirmText.trim() === "DELETE";

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteBusiness(tenant.id, { confirmName: confirmText.trim(), permanent });
      onDeleted();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not delete business.") : "Could not delete business.");
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={step === 1 ? "Delete business" : "Confirm deletion"}>
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This action is <strong>irreversible</strong> once confirmed for Permanent delete. Soft delete can be
              undone from this page; Permanent delete cannot.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 rounded-xl border border-neutral-200 p-3 text-sm">
              <input type="radio" checked={!permanent} onChange={() => setPermanent(false)} className="mt-0.5" />
              <span>
                <span className="font-medium text-neutral-900">Soft delete (recommended)</span>
                <br />
                <span className="text-neutral-500">
                  Hides {tenant.businessName} from the dashboard and blocks login. All data is preserved and can be
                  restored at any time.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-xl border border-red-200 p-3 text-sm">
              <input type="radio" checked={permanent} onChange={() => setPermanent(true)} className="mt-0.5" />
              <span>
                <span className="font-medium text-red-800">Permanently delete</span>
                <br />
                <span className="text-red-700">
                  Immediately and permanently removes {tenant.businessName} and every related record — users,
                  integrations, website content, credentials — with no way to recover it.
                </span>
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-700">
            Type <strong>{tenant.businessName}</strong> (or <strong>DELETE</strong>) to confirm you want to
            {permanent ? " permanently delete " : " soft-delete "}
            this business.
          </p>
          <input
            type="text"
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant.businessName}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="button" variant="danger" disabled={!confirmed || deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : permanent ? "Permanently delete" : "Delete business"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
