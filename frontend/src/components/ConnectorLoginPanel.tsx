import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react";
import { listActiveModules, type ModuleInfo } from "../api/websiteContent";
import { getConnectorLoginStatus, saveConnectorLogin, refreshConnectorToken, type ConnectorLoginStatus } from "../api/connectorLogin";
import { useToast } from "./Toast";
import { Button } from "./Button";
import { Modal } from "./Modal";

// Tenant-facing "Log in with admin credentials" setup + refresh, for
// whichever of this tenant's active connectors use it. The rest of
// connector configuration (base URL, other auth types, field mapping)
// stays Super-Admin-only — this is the one exception (see
// backend/src/routes/connectorLogin.ts's file comment).

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

type RowState = { module: ModuleInfo; status: ConnectorLoginStatus | null };

export function ConnectorLoginPanel() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<ModuleInfo | null>(null);

  async function load() {
    try {
      const modules = await listActiveModules();
      const withStatus = await Promise.all(
        modules.map(async (module) => {
          try {
            return { module, status: await getConnectorLoginStatus(module.key) };
          } catch {
            return { module, status: null };
          }
        })
      );
      setRows(withStatus);
    } catch {
      showToast("Could not load connector status.");
      setRows([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh(module: ModuleInfo) {
    setRefreshingKey(module.key);
    try {
      await refreshConnectorToken(module.key);
      showToast(`Access token refreshed for ${module.label}.`);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not refresh the access token.") : "Could not refresh the access token.");
    } finally {
      setRefreshingKey(null);
    }
  }

  if (rows === null) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  const loginRows = rows.filter((r) => r.status !== null);
  if (loginRows.length === 0) {
    return <p className="text-sm text-neutral-500">No connected data sources yet — nothing to authenticate.</p>;
  }

  const anyExpired = loginRows.some((r) => r.status!.credentialStatus === "CredentialsExpired");

  return (
    <div>
      {anyExpired && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            One or more connections need attention — their stored credentials are no longer working. Data won't sync for
            that module until you reconnect it below.
          </p>
        </div>
      )}
      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
        {loginRows.map(({ module, status }) => {
          const s = status!;
          const expired = s.credentialStatus === "CredentialsExpired";
          const expiry = formatExpiry(s.tokenExpiresAt);
          const busy = refreshingKey === module.key;
          return (
            <div key={module.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{module.label}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {/* credentialStatus is tracked for every auth type, not just
                      "login" — a plain pasted bearer token going stale is just
                      as real a "needs attention" case, so this alert can't be
                      gated on loginConfigured. */}
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      expired
                        ? "bg-red-100 text-red-700"
                        : s.loginConfigured
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {expired ? "Needs reconnecting" : s.loginConfigured ? "Connected" : "Not using login-based access"}
                  </span>
                  {s.loginConfigured && expiry && (
                    <span className={expiry.expired ? "text-red-600" : "text-neutral-400"}>{expiry.text}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.loginConfigured && (
                  <Button variant="secondary" onClick={() => handleRefresh(module)} disabled={busy}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {busy ? "Refreshing…" : "Get / Refresh Access Token"}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setEditingModule(module)}>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  {s.loginConfigured ? "Edit login details" : "Log in with admin credentials"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {editingModule && (
        <LoginSetupModal
          module={editingModule}
          // Reload on close too, not just on a successful save: a failed
          // save (wrong password) still persists the new credentials and
          // flips credentialStatus to CredentialsExpired server-side (see
          // saveLoginCredentials) even though the route responds 400 — so
          // dismissing the modal without this would leave the row showing
          // its last-loaded (stale) status until something else happened
          // to trigger a reload.
          onClose={() => {
            setEditingModule(null);
            load();
          }}
          onSaved={async () => {
            setEditingModule(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function LoginSetupModal({ module, onClose, onSaved }: { module: ModuleInfo; onClose: () => void; onSaved: () => void }) {
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
      await saveConnectorLogin(module.key, { loginUrl, email, password });
      showToast(`Logged in — ${module.label} is now using your admin credentials.`);
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save login details.") : "Could not save login details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Log in with admin credentials — ${module.label}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-neutral-500">
          Enter YOUR website's own login details (not a BizzCore account) — the same email and password you'd use to
          sign in to {module.label.toLowerCase()}'s admin panel on your own site. We'll log in on your behalf and keep
          the access token refreshed automatically.
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
