import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react";
import { listConnectorDataSources, saveConnectorLogin, refreshConnectorToken, type ConnectorDataSource } from "../api/connectorLogin";
import { useToast } from "./Toast";
import { Button } from "./Button";
import { Modal } from "./Modal";

// Tenant-facing "Log in with admin credentials" setup + refresh — one row
// per CONNECTED WEBSITE (DataSource), not per feature. Every feature on the
// same site shares one login/token (see backend/src/lib/connectorLogin.ts);
// showing this per-feature previously let two features on the identical
// site each get configured with their own, separately-typed (and
// separately wrong) login URL — the exact mistake this grouping prevents.
// The rest of connector configuration (base URL, other auth types, field
// mapping) stays Super-Admin-only and per-feature — this is the one
// exception (see backend/src/routes/connectorLogin.ts's file comment).

function formatExpiry(iso: string | null): { text: string; expired: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: `expired ${formatDuration(-ms)} ago`, expired: true };
  return { text: `expires in ${formatDuration(ms)}`, expired: false };
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ConnectorLoginPanel() {
  const { showToast } = useToast();
  const [dataSources, setDataSources] = useState<ConnectorDataSource[] | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<ConnectorDataSource | null>(null);

  async function load() {
    try {
      setDataSources(await listConnectorDataSources());
    } catch {
      showToast("Could not load connector status.", "error");
      setDataSources([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any one of this DataSource's features works as the write action's
  // routing key — they all resolve to the same DataSource server-side.
  function representativeFeatureKey(ds: ConnectorDataSource): string {
    return ds.features[0].key;
  }

  async function handleRefresh(ds: ConnectorDataSource) {
    setRefreshingId(ds.id);
    try {
      await refreshConnectorToken(representativeFeatureKey(ds));
      showToast(`Access token refreshed for ${ds.origin}.`);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not refresh the access token.") : "Could not refresh the access token.", "error");
    } finally {
      setRefreshingId(null);
    }
  }

  if (dataSources === null) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (dataSources.length === 0) {
    return <p className="text-sm text-neutral-500">No connected data sources yet — nothing to authenticate.</p>;
  }

  const anyExpired = dataSources.some((d) => d.credentialStatus === "CredentialsExpired");

  return (
    <div>
      {anyExpired && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            One or more connections need attention — their stored credentials are no longer working. Data won't sync for
            that site until you reconnect it below.
          </p>
        </div>
      )}
      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
        {dataSources.map((ds) => {
          const expired = ds.credentialStatus === "CredentialsExpired";
          const expiry = formatExpiry(ds.tokenExpiresAt);
          const busy = refreshingId === ds.id;
          return (
            <div key={ds.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{ds.origin}</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Used by: {ds.features.map((f) => f.label).join(", ")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      expired
                        ? "bg-red-100 text-red-700"
                        : ds.loginConfigured
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {expired ? "Needs reconnecting" : ds.loginConfigured ? "Connected" : "Not using login-based access"}
                  </span>
                  {ds.loginConfigured && expiry && (
                    <span className={expiry.expired ? "text-red-600" : "text-neutral-400"}>{expiry.text}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ds.loginConfigured && (
                  <Button variant="secondary" onClick={() => handleRefresh(ds)} disabled={busy}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {busy ? "Refreshing…" : "Get / Refresh Access Token"}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setEditingSource(ds)}>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  {ds.loginConfigured ? "Edit login details" : "Log in with admin credentials"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {editingSource && (
        <LoginSetupModal
          dataSource={editingSource}
          // Reload on close too, not just on a successful save: a failed
          // save (wrong password) still persists the new credentials and
          // flips credentialStatus to CredentialsExpired server-side (see
          // saveLoginCredentials) even though the route responds 400 — so
          // dismissing the modal without this would leave the row showing
          // its last-loaded (stale) status until something else happened
          // to trigger a reload.
          onClose={() => {
            setEditingSource(null);
            load();
          }}
          onSaved={async () => {
            setEditingSource(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function LoginSetupModal({
  dataSource,
  onClose,
  onSaved,
}: {
  dataSource: ConnectorDataSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [loginUrl, setLoginUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await saveConnectorLogin(dataSource.features[0].key, { loginUrl, email, password });
      showToast(`Logged in — ${dataSource.origin} is now using your admin credentials.`);
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save login details.") : "Could not save login details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Log in with admin credentials — ${dataSource.origin}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-neutral-500">
          Enter YOUR website's own login details (not a BizzCore account) — the same email and password you'd use to
          sign in to {dataSource.origin}'s admin panel. This is a single login for the whole site — every feature
          connected to it ({dataSource.features.map((f) => f.label).join(", ")}) will use the same token, refreshed
          automatically.
        </p>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Login endpoint URL</label>
          <input
            type="url"
            required
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            placeholder="https://your-site.example.com/api/auth/login"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Never shown again after saving"
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Logging in…" : "Log in & Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
