import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { CheckCircle2, Globe2, XCircle, Tag, Star, Trash2, Pencil, Check, X, MessageSquareText } from "lucide-react";
import {
  getIntegrations,
  saveMetaCredentials,
  disconnectMeta,
  saveWhatsAppCredentials,
  disconnectWhatsApp,
  type MetaStatus,
  type WhatsAppStatus,
} from "../../api/settings";
import { listWhatsAppTemplates, createWhatsAppTemplate, type TemplatesStatus } from "../../api/whatsappTemplates";
import { listActiveModules, importWebsiteContentItems, syncWebsiteContentItems } from "../../api/websiteContent";
import { connectorConfigApi } from "../../api/connectorConfig";
import {
  listCustomerCategories,
  createCustomerCategory,
  updateCustomerCategory,
  deleteCustomerCategory,
  type CustomerCategory,
} from "../../api/customerCategories";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { WebsiteModulesPanel } from "../../components/WebsiteModulesPanel";
import { WebsiteIntegrationsPanel } from "../../components/WebsiteIntegrationsPanel";
import { ConnectorLoginPanel } from "../../components/ConnectorLoginPanel";

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
      <XCircle className="h-3.5 w-3.5" /> Not connected
    </span>
  );
}

export default function Settings() {
  const { showToast } = useToast();
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);

  async function load() {
    try {
      const data = await getIntegrations();
      setMeta(data.meta);
      setWhatsapp(data.whatsapp);
    } catch {
      showToast("Could not load integration settings.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Connect your Meta (Instagram &amp; Facebook) and WhatsApp Business accounts so Communication Center and
        Social Media Manager can send for real instead of running in mock mode.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MetaSettingsCard status={meta} onChanged={load} />
        <WhatsAppSettingsCard status={whatsapp} onChanged={load} />
      </div>

      <div className="mt-6">
        <WhatsAppTemplatesCard whatsappStatus={whatsapp} />
      </div>

      <div className="mt-6">
        <CustomerCategoriesCard />
      </div>

      <div className="mt-6">
        <Card>
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-neutral-400" />
            <h2 className="font-serif text-lg text-neutral-900">Connector configuration</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Connect each feature to your own website's API — base URL, authentication, and field mapping.
            Configuring a feature here gives you full manage access to its content below.
          </p>
          <div className="mt-4">
            <WebsiteIntegrationsPanel api={connectorConfigApi} />
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-neutral-400" />
            <h2 className="font-serif text-lg text-neutral-900">Website Modules</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Content for each feature you've connected above — create, edit, import, and sync.
          </p>
          <div className="mt-4">
            <WebsiteModulesPanel
              api={{
                listModules: listActiveModules,
                importModule: importWebsiteContentItems,
                syncModule: syncWebsiteContentItems,
              }}
            />
          </div>
        </Card>
      </div>

      <div id="data-source-access" className="mt-6 scroll-mt-6">
        <Card>
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-neutral-400" />
            <h2 className="font-serif text-lg text-neutral-900">Data Source Access</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            For a connected website that only offers a login (not a long-lived token you can paste in), log in with
            your own site's admin credentials here — we'll keep the access token refreshed automatically.
          </p>
          <div className="mt-4">
            <ConnectorLoginPanel />
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetaSettingsCard({ status, onChanged }: { status: MetaStatus | null; onChanged: () => void }) {
  const { showToast } = useToast();
  const [appId, setAppId] = useState("");
  const [pageId, setPageId] = useState("");
  const [igBusinessAccountId, setIgBusinessAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!status) return;
    setAppId(status.appId ?? "");
    setPageId(status.pageId ?? "");
    setIgBusinessAccountId(status.igBusinessAccountId ?? "");
  }, [status]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await saveMetaCredentials({
        appId: appId || undefined,
        pageId: pageId || undefined,
        igBusinessAccountId: igBusinessAccountId || undefined,
        accessToken: accessToken || undefined,
      });
      setAccessToken("");
      showToast("Meta credentials saved");
      onChanged();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save credentials.") : "Could not save credentials.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectMeta();
      setAppId("");
      setPageId("");
      setIgBusinessAccountId("");
      setAccessToken("");
      showToast("Meta disconnected");
      onChanged();
    } catch {
      showToast("Could not disconnect Meta.", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-neutral-900">Meta (Instagram &amp; Facebook)</h2>
        {status && <StatusBadge connected={status.connected} />}
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Used for Instagram DMs, Facebook DMs, post publishing, and comment replies.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label="App ID" value={appId} onChange={setAppId} />
        <Field label="Facebook Page ID" value={pageId} onChange={setPageId} />
        <Field label="Instagram Business Account ID" value={igBusinessAccountId} onChange={setIgBusinessAccountId} />
        <div>
          <label className="block text-sm font-medium text-neutral-700">Access token</label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={status?.hasAccessToken ? "•••••••••• (leave blank to keep current)" : "Paste your access token"}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {status?.connected && (
            <Button type="button" variant="danger" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function WhatsAppSettingsCard({ status, onChanged }: { status: WhatsAppStatus | null; onChanged: () => void }) {
  const { showToast } = useToast();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!status) return;
    setPhoneNumberId(status.phoneNumberId ?? "");
    setWabaId(status.wabaId ?? "");
  }, [status]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await saveWhatsAppCredentials({ phoneNumberId, wabaId, accessToken: accessToken || undefined });
      setAccessToken("");
      showToast("WhatsApp credentials saved");
      onChanged();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save credentials.") : "Could not save credentials.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectWhatsApp();
      setPhoneNumberId("");
      setWabaId("");
      setAccessToken("");
      showToast("WhatsApp disconnected");
      onChanged();
    } catch {
      showToast("Could not disconnect WhatsApp.", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-neutral-900">WhatsApp Business Platform</h2>
        {status && <StatusBadge connected={status.connected} />}
      </div>
      <p className="mt-1 text-sm text-neutral-500">Used for the unified inbox and scheduled broadcasts.</p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label="Phone Number ID *" value={phoneNumberId} onChange={setPhoneNumberId} required />
        <div>
          <Field label="WhatsApp Business Account ID *" value={wabaId} onChange={setWabaId} required />
          <p className="mt-1 text-xs text-neutral-400">
            From the same Meta for Developers &rarr; WhatsApp &rarr; API Setup page as your Phone Number ID. Needed to
            manage message templates below.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Access token</label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={status?.hasAccessToken ? "•••••••••• (leave blank to keep current)" : "Paste your Cloud API token"}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {status?.connected && (
            <Button type="button" variant="danger" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

const TEMPLATE_CATEGORY_OPTIONS = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

const TEMPLATE_STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700",
};

// WhatsApp Message Templates — Meta's Template Management API
// (whatsapp_business_management), scoped to the tenant's own WABA (see the
// WhatsApp card above). A thin pass-through to Meta: this list is always
// fetched live, never cached locally, so status shown here is always
// Meta's current truth, not a stale local copy.
function WhatsAppTemplatesCard({ whatsappStatus }: { whatsappStatus: WhatsAppStatus | null }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<TemplatesStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    try {
      setStatus(await listWhatsAppTemplates());
    } catch {
      showToast("Could not load WhatsApp templates.", "error");
    }
  }

  useEffect(() => {
    // Only worth asking once WhatsApp is actually connected — avoids a
    // guaranteed-empty round trip on first load for a tenant who hasn't
    // set anything up yet.
    if (whatsappStatus?.connected) load();
  }, [whatsappStatus?.connected]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-neutral-400" />
          <h2 className="font-serif text-lg text-neutral-900">WhatsApp Templates</h2>
        </div>
        {status?.wabaConfigured && <Button onClick={() => setModalOpen(true)}>+ New Template</Button>}
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Pre-approved WhatsApp messages you can send to a customer even outside the normal 24-hour reply window.
      </p>

      <div className="mt-4">
        {!whatsappStatus?.connected && <p className="text-sm text-neutral-400">Connect WhatsApp above to manage templates.</p>}
        {whatsappStatus?.connected && status && !status.wabaConfigured && (
          <p className="text-sm text-amber-600">Add your WhatsApp Business Account ID above to manage templates.</p>
        )}
        {status?.wabaConfigured && status.templates.length === 0 && <p className="text-sm text-neutral-400">No templates yet.</p>}
        {status?.wabaConfigured && status.templates.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {status.templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{t.name}</p>
                  <p className="text-xs text-neutral-400">
                    {t.category} · {t.language}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    TEMPLATE_STATUS_STYLES[t.status] ?? "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewTemplateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          load();
        }}
      />
    </Card>
  );
}

function NewTemplateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof TEMPLATE_CATEGORY_OPTIONS)[number]>("UTILITY");
  const [language, setLanguage] = useState("en_US");
  const [bodyText, setBodyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetAndClose() {
    setName("");
    setCategory("UTILITY");
    setLanguage("en_US");
    setBodyText("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createWhatsAppTemplate({ name: name.trim(), category, language: language.trim(), bodyText: bodyText.trim() });
      resetAndClose();
      onCreated();
    } catch (err) {
      setError(
        axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not create template.") : "Could not create template."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="New WhatsApp Template">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            placeholder="order_confirmation"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
          <p className="mt-1 text-xs text-neutral-400">Lowercase letters, numbers, and underscores only (Meta's rule).</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof TEMPLATE_CATEGORY_OPTIONS)[number])}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {TEMPLATE_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c[0] + c.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Language code</label>
          <input
            required
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="en_US"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Body text</label>
          <textarea
            required
            rows={4}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder={"Hi {{1}}, your order {{2}} has shipped!"}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Use {"{{1}}"}, {"{{2}}"}, … for variables filled in at send time.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for approval"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Tenant-scoped categories used to segment Customers and target
// Communication Center broadcasts (see api/customerCategories.ts). Seeded
// with Regular/VIP/Bridal on first access — this panel lets a tenant Admin
// add their own, rename any of them (renames cascade to every customer/
// broadcast currently using the old name — see the backend route's
// comment), toggle which ones count as "priority" for the Home dashboard's
// follow-up stat, and delete ones no longer in use.
function CustomerCategoriesCard() {
  const { showToast } = useToast();
  const [categories, setCategories] = useState<CustomerCategory[] | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setCategories(await listCustomerCategories());
    } catch {
      showToast("Could not load customer categories.", "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await createCustomerCategory({ name: newName.trim() });
      setNewName("");
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not add category.") : "Could not add category.", "error");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(c: CustomerCategory) {
    setEditingId(c.id);
    setEditValue(c.name);
  }

  async function handleRename(id: string) {
    if (!editValue.trim()) return;
    setBusyId(id);
    try {
      await updateCustomerCategory(id, { name: editValue.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not rename category.") : "Could not rename category.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleTogglePriority(c: CustomerCategory) {
    setBusyId(c.id);
    try {
      await updateCustomerCategory(c.id, { isPriority: !c.isPriority });
      await load();
    } catch {
      showToast("Could not update category.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: CustomerCategory) {
    setBusyId(c.id);
    try {
      await deleteCustomerCategory(c.id);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not delete category.") : "Could not delete category.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-neutral-400" />
        <h2 className="font-serif text-lg text-neutral-900">Customer Categories</h2>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Categorize customers and booking requests beyond the defaults (Regular, VIP, Bridal) — add your own, and mark
        which ones should surface as priority follow-ups on the Home dashboard.
      </p>

      <div className="mt-4 space-y-2">
        {categories === null && <p className="text-sm text-neutral-400">Loading…</p>}
        {categories?.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2">
            {editingId === c.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
                <button
                  onClick={() => handleRename(c.id)}
                  disabled={busyId === c.id}
                  className="text-emerald-600 hover:text-emerald-700"
                  aria-label="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => setEditingId(null)} className="text-neutral-400 hover:text-neutral-600" aria-label="Cancel">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{c.name}</span>
                  {c.isBuiltIn && <span className="text-xs text-neutral-400">default</span>}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleTogglePriority(c)}
                    disabled={busyId === c.id}
                    title={c.isPriority ? "Priority — shown in Home dashboard follow-ups" : "Mark as priority"}
                    className={c.isPriority ? "text-gold" : "text-neutral-300 hover:text-neutral-400"}
                    aria-label={c.isPriority ? "Unmark as priority" : "Mark as priority"}
                  >
                    <Star className="h-4 w-4" fill={c.isPriority ? "currentColor" : "none"} />
                  </button>
                  <button onClick={() => startEdit(c)} className="text-neutral-400 hover:text-maroon" aria-label={`Rename ${c.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={busyId === c.id}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="mt-4 flex gap-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
        <Button type="submit" disabled={adding || !newName.trim()}>
          {adding ? "Adding…" : "Add Category"}
        </Button>
      </form>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700">{label}</label>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
    </div>
  );
}
