import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { CheckCircle2, Globe2, XCircle } from "lucide-react";
import {
  getIntegrations,
  saveMetaCredentials,
  disconnectMeta,
  saveWhatsAppCredentials,
  disconnectWhatsApp,
  type MetaStatus,
  type WhatsAppStatus,
} from "../../api/settings";
import { listActiveModules, importWebsiteContentItems, syncWebsiteContentItems } from "../../api/websiteContent";
import { connectorConfigApi } from "../../api/connectorConfig";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
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
    <div className="px-8 py-8">
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

      <div className="mt-6">
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

        <div className="flex gap-3">
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
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!status) return;
    setPhoneNumberId(status.phoneNumberId ?? "");
  }, [status]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await saveWhatsAppCredentials({ phoneNumberId, accessToken: accessToken || undefined });
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

        <div className="flex gap-3">
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
