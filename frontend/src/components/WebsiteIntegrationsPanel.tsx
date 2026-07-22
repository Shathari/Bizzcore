import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import axios from "axios";
import { Pencil, Trash2, Plus, X, ChevronDown, CheckCircle2, XCircle, Lock } from "lucide-react";
import {
  type WebsiteIntegrationStatus,
  type AuthType,
  type PermissionLevel,
  type HttpMethod,
  type EndpointInput,
  type ResponseMapping,
  type TestEndpointResult,
  type DiscoveredField,
  type DiscoverSchemaResult,
  type FieldDef,
  type SchemaSnapshot,
  type ConnectorAccessLogEntry,
} from "../api/superAdminWebsite";
import { updateFeatureCatalogEntry } from "../api/featureCatalog";
import { useToast } from "./Toast";
import { Modal } from "./Modal";
import { Button } from "./Button";

// Tenant-Admin-facing: configures, per feature, the external website API
// this tenant's own dashboard actions get pushed to. Bound to
// api/connectorConfig.ts (tenant-scoped via auth, no tenantId param) from
// pages/tenant/Settings.tsx. Super Admin has no write access to any of
// this — their view is the separate, read-only ConnectionHealthPanel.tsx
// on pages/super-admin/BusinessDetail.tsx (see
// routes/superAdminWebsiteIntegrations.ts's comment).
//
// Per-method layout: rather than a separate "shared authentication"
// section plus an opt-in "per-method overrides" section (the pre-refactor
// design), every method gets one row with its own URL + auth. The GET
// row's auth IS the shared/base authType+credentials the backend falls
// back to for every other method with no override (see
// lib/websiteApiClient.ts's resolveEndpoint) — verified against real saved
// data that no tenant actually uses a GET-specific auth override distinct
// from that shared auth, so this mapping covers every real case without
// needing a separate "shared auth" UI concept. POST/PUT/PATCH/DELETE rows
// default to "Same as GET"; picking any other auth type (or typing a URL)
// for those rows creates a real per-method override, identical to what the
// old "+ Add override…" flow produced — same wire format, same backend,
// just no longer a separate, easy-to-miss section.
export type WebsiteIntegrationsApi = {
  list: () => Promise<WebsiteIntegrationStatus[]>;
  save: (
    featureKey: string,
    input: {
      baseUrl: string;
      authType: AuthType;
      credentials?: Record<string, string>;
      active?: boolean;
      permissionLevel?: PermissionLevel;
      fieldMapping?: Record<string, string> | null;
      responseMapping?: ResponseMapping | null;
      endpoints?: EndpointInput[];
      lookupKey?: string | null;
      confidentialFields?: string[];
      confidentialWriteEnabled?: string[];
    }
  ) => Promise<WebsiteIntegrationStatus>;
  remove: (featureKey: string) => Promise<void>;
  test: (
    featureKey: string,
    input: { method: HttpMethod; url: string; authType: AuthType; credentials?: Record<string, string> }
  ) => Promise<TestEndpointResult>;
  discoverSchema: (
    featureKey: string,
    input: { url: string; authType: AuthType; credentials?: Record<string, string> }
  ) => Promise<DiscoverSchemaResult>;
  schemaHistory: (featureKey: string) => Promise<SchemaSnapshot[]>;
  accessLog: (featureKey: string) => Promise<ConnectorAccessLogEntry[]>;
};

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  none: "None",
  bearer: "Bearer token",
  apiKey: "API key",
  basic: "Basic auth",
  customHeaders: "Custom header",
};

export function permissionLabel(level: PermissionLevel): string {
  return level === "MANAGE" ? "Manage" : "View only";
}

// Conventional URL a method resolves to when no override is configured —
// mirrors lib/websiteApiClient.ts's callWebsiteApi (POST to baseUrl;
// PUT/PATCH/DELETE to `${baseUrl}/${externalId}`, or — when a lookup key
// is configured — `${baseUrl}?{lookupKey}={value}`, shown here with
// placeholders since the real values are only known at request time).
function conventionUrl(method: HttpMethod, baseUrl: string, lookupKey?: string | null): string {
  if (method === "GET" || method === "POST") return baseUrl || "(base URL)";
  if (lookupKey) return `${baseUrl || "(base URL)"}?${lookupKey}={value}`;
  return `${baseUrl || "(base URL)"}/{id}`;
}

export function WebsiteIntegrationsPanel({ api }: { api: WebsiteIntegrationsApi }) {
  const { showToast } = useToast();
  const [integrations, setIntegrations] = useState<WebsiteIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  async function load() {
    try {
      setIntegrations(await api.list());
    } catch {
      showToast("Could not load website integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRemove(status: WebsiteIntegrationStatus) {
    setBusy(true);
    try {
      await api.remove(status.featureKey);
      await load();
      showToast(`${status.featureLabel} integration removed`);
    } catch {
      showToast("Could not remove integration.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(status: WebsiteIntegrationStatus) {
    if (!status.baseUrl) return;
    setBusy(true);
    try {
      await api.save(status.featureKey, {
        baseUrl: status.baseUrl,
        authType: status.authType,
        active: !status.active,
        permissionLevel: status.permissionLevel,
      });
      await load();
      showToast(`${status.featureLabel} ${status.active ? "disabled" : "enabled"}`);
    } catch {
      showToast("Could not update integration.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  return (
    <>
      <div className="divide-y divide-neutral-100">
        {integrations.map((status) => (
          <div key={status.featureKey} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-neutral-900">{status.featureLabel}</p>
              {status.configured ? (
                <p className="text-xs text-neutral-500">
                  {status.baseUrl} · {AUTH_TYPE_LABELS[status.authType]}
                  {!status.active && <span className="ml-2 text-amber-600">No access (disabled)</span>}
                  {status.active && (
                    <span className={`ml-2 ${status.permissionLevel === "MANAGE" ? "text-emerald-600" : "text-neutral-500"}`}>
                      {permissionLabel(status.permissionLevel)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-neutral-400">Not configured</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status.configured && (
                <>
                  <button
                    onClick={() => handleToggleActive(status)}
                    disabled={busy}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {status.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleRemove(status)}
                    disabled={busy}
                    aria-label={`Remove ${status.featureLabel} integration`}
                    className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => setOpenKey(status.featureKey)}
                aria-label={`${status.configured ? "View" : "Configure"} ${status.featureLabel} integration`}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-maroon"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {openKey && (
        <WebsiteIntegrationDetailModal
          api={api}
          featureKey={openKey}
          current={integrations.find((i) => i.featureKey === openKey) ?? null}
          onClose={() => setOpenKey(null)}
          onSaved={async () => {
            setOpenKey(null);
            await load();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits: custom-header rows, field-mapping rows, the Test button.
// ---------------------------------------------------------------------------

type CustomHeaderRow = { name: string; value: string };

// Existing header names/values are never sent back by the API (only a
// hasCredentials boolean) — leaving these empty on edit keeps whatever's
// already configured, same "blank keeps current" pattern as every other
// auth type here.
function CustomHeaderFields({
  rows,
  hadExisting,
  onAdd,
  onRemove,
  onUpdate,
}: {
  rows: CustomHeaderRow[];
  hadExisting: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<CustomHeaderRow>) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      {hadExisting && rows.length === 0 && (
        <p className="text-xs text-neutral-400">Existing headers configured — leave empty to keep them, or add rows to replace them.</p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="text"
            value={row.name}
            onChange={(e) => onUpdate(index, { name: e.target.value })}
            placeholder="Header name"
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
          <input
            type="password"
            value={row.value}
            onChange={(e) => onUpdate(index, { value: e.target.value })}
            placeholder="Value"
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
          <button type="button" onClick={() => onRemove(index)} aria-label="Remove header" className="text-neutral-400 hover:text-red-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd} className="text-xs font-semibold text-maroon hover:underline">
        + Add header
      </button>
    </div>
  );
}

type FieldMappingRow = { dashboardField: string; externalField: string };

function fieldMappingRowsFrom(mapping: Record<string, string> | null | undefined): FieldMappingRow[] {
  return mapping ? Object.entries(mapping).map(([dashboardField, externalField]) => ({ dashboardField, externalField })) : [];
}

// "+ Create new field…" bridge — building a real dashboard field, one
// created via lib/featureCatalog.ts's existing updateFeature (reused
// as-is through api/featureCatalog.ts, no new field-creation code). Only
// offers the types this compact inline form can meaningfully collect —
// "select" needs an options list, out of scope for an inline row.
type SimpleFieldType = "text" | "textarea" | "number" | "date" | "image" | "checkbox";
const CUSTOM_FIELD_TYPES: SimpleFieldType[] = ["text", "textarea", "number", "date", "image", "checkbox"];

function suggestFieldType(discoveredType: DiscoveredField["type"]): SimpleFieldType {
  if (discoveredType === "number") return "number";
  if (discoveredType === "boolean") return "checkbox";
  if (discoveredType === "date") return "date";
  return "text"; // string, array, object
}

function suggestKeyAndLabel(path: string): { key: string; label: string } {
  const lastSegment = (path.split(".").pop() ?? path).replace(/\[\d+\]/g, "");
  const key = lastSegment || path;
  const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2");
  return { key, label };
}

function buildFieldDef(draft: { key: string; label: string; type: SimpleFieldType }): FieldDef {
  if (draft.type === "checkbox") return { key: draft.key, label: draft.label, type: "checkbox" };
  return { key: draft.key, label: draft.label, type: draft.type };
}

type CustomFieldDraft = { rowIndex: number; key: string; label: string; type: SimpleFieldType };

function CustomFieldDraftForm({
  draft,
  onChange,
  onCancel,
  onConfirm,
}: {
  draft: CustomFieldDraft;
  onChange: (patch: Partial<CustomFieldDraft>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-maroon/30 bg-maroon/5 p-2">
      <input
        type="text"
        value={draft.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder="Field key"
        className="flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
      <input
        type="text"
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Field label"
        className="flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
      />
      <select
        value={draft.type}
        onChange={(e) => onChange({ type: e.target.value as SimpleFieldType })}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
      >
        {CUSTOM_FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!draft.key.trim() || !draft.label.trim()}
        className="rounded-lg bg-maroon px-2.5 py-1 text-xs font-semibold text-white hover:bg-maroon-dark disabled:opacity-50"
      >
        Add
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel new field" className="text-neutral-400 hover:text-red-600">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Read-only list of past Analyze/Refresh results (newest first, capped
// server-side — see backend's SCHEMA_SNAPSHOT_RETENTION). Each row expands
// in place to show that snapshot's field list, for comparing "what did
// this look like before" without leaving the modal. Exported for reuse by
// ConnectionHealthPanel.tsx's read-only Super Admin view.
export function SchemaHistoryList({ loading, history }: { loading: boolean; history: SchemaSnapshot[] | null }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return <p className="mt-2 text-xs text-neutral-400">Loading history…</p>;
  }
  if (!history || history.length === 0) {
    return <p className="mt-2 text-xs text-neutral-400">No past analyses yet.</p>;
  }

  return (
    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
      {history.map((snapshot) => {
        const expanded = expandedId === snapshot.id;
        return (
          <div key={snapshot.id}>
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : snapshot.id)}
              className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-50"
            >
              <span>{new Date(snapshot.discoveredAt).toLocaleString()}</span>
              <span className="text-neutral-400">{snapshot.fields.length} fields</span>
            </button>
            {expanded && (
              <div className="ml-1.5 flex flex-wrap gap-x-3 gap-y-1 border-l border-neutral-200 px-2 py-1 text-xs text-neutral-500">
                {snapshot.fields.map((f) => (
                  <span key={f.path}>
                    {f.path} <span className="text-neutral-400">({f.type})</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Connector audit trail — who saved credentials, tested, analyzed, or
// synced this feature, when, and with what outcome. actorLabel already
// resolves a null actorId (system/cron action) to "System (...)"
// server-side — never rendered blank here, same discipline as the Customer
// PII "Recent access" panel. Exported for reuse by
// ConnectionHealthPanel.tsx's read-only Super Admin view.
export function ConnectorAccessLogList({ loading, entries }: { loading: boolean; entries: ConnectorAccessLogEntry[] | null }) {
  if (loading) {
    return <p className="mt-2 text-xs text-neutral-400">Loading activity…</p>;
  }
  if (!entries || entries.length === 0) {
    return <p className="mt-2 text-xs text-neutral-400">No connector activity recorded yet.</p>;
  }
  return (
    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-2 px-1.5 py-1 text-xs">
          <span className="flex items-center gap-1.5 text-neutral-600">
            {e.outcome === "success" ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="h-3 w-3 shrink-0 text-red-600" />
            )}
            <span className="font-medium text-neutral-800">{e.actionLabel}</span>
            <span className="text-neutral-400">by {e.actorLabel}</span>
          </span>
          <span className="shrink-0 text-neutral-400">{new Date(e.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

type TestState = { status: "idle" } | { status: "testing" } | { status: "done"; result: TestEndpointResult };

function TestButton({
  onTest,
  disabledReason,
}: {
  onTest: () => Promise<TestEndpointResult>;
  disabledReason?: string;
}) {
  const [state, setState] = useState<TestState>({ status: "idle" });

  async function handleClick() {
    setState({ status: "testing" });
    try {
      const result = await onTest();
      setState({ status: "done", result });
    } catch (err) {
      setState({
        status: "done",
        result: {
          ok: false,
          latencyMs: 0,
          message: axios.isAxiosError(err) ? (err.response?.data?.error ?? "Test failed.") : "Test failed.",
        },
      });
    }
  }

  const disabled = Boolean(disabledReason);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || state.status === "testing"}
        title={disabled ? disabledReason : undefined}
        className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.status === "testing" ? "Testing…" : "Test"}
      </button>
      {state.status === "done" && (
        <span
          className={`flex min-w-0 items-center gap-1 truncate text-xs ${state.result.ok ? "text-emerald-600" : "text-red-600"}`}
          title={`${state.result.message} (${state.result.latencyMs}ms)`}
        >
          {state.result.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">
            {state.result.message} · {state.result.latencyMs}ms
          </span>
        </span>
      )}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-neutral-700"
      >
        {label}
        <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-neutral-200 p-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-method row state
// ---------------------------------------------------------------------------

type AuthChoice = AuthType | "default";

type MethodRowState = {
  method: HttpMethod;
  url: string; // "" = use the REST convention (baseUrl, or baseUrl/{id})
  authType: AuthChoice; // "default" (non-GET only) = same as GET/shared, no override
  token: string;
  headerName: string;
  apiKey: string;
  username: string;
  password: string;
  customHeaders: CustomHeaderRow[];
  hadCredentials: boolean;
};

function blankRow(method: HttpMethod, authType: AuthChoice, url: string, hadCredentials: boolean): MethodRowState {
  return { method, url, authType, token: "", headerName: "", apiKey: "", username: "", password: "", customHeaders: [], hadCredentials };
}

// See this file's top comment for why GET's auth is treated as the shared
// auth: verified against real saved data that no tenant has a GET override
// with its own authType distinct from the shared one. If such a row ever
// does exist (only reachable via direct API use, not any UI), it's shown/
// edited here transparently instead of being silently dropped.
function deriveMethodRows(current: WebsiteIntegrationStatus | null): MethodRowState[] {
  return HTTP_METHODS.map((method) => {
    const override = current?.endpoints.find((e) => e.method === method);
    if (method === "GET") {
      const legacyDistinctAuth = Boolean(override?.authType);
      return blankRow(
        method,
        legacyDistinctAuth ? (override!.authType as AuthType) : (current?.authType ?? "none"),
        override?.url ?? "",
        legacyDistinctAuth ? override!.hasCredentials : Boolean(current?.hasCredentials)
      );
    }
    return blankRow(method, (override?.authType as AuthType | undefined) ?? "default", override?.url ?? "", override?.hasCredentials ?? false);
  });
}

// Builds the { [headerOrField]: value } credentials object for one row's
// currently-selected concrete auth type, or undefined to mean "leave
// whatever's already saved for this slot untouched" (blank-keeps-current).
// Returns { error } instead when a required field is missing and there's
// nothing existing to fall back to.
function buildRowCredentials(row: MethodRowState): { credentials?: Record<string, string>; error?: string } {
  const authType = row.authType as AuthType;
  if (authType === "bearer") {
    if (!row.token.trim()) return row.hadCredentials ? {} : { error: `${row.method}: token is required` };
    return { credentials: { token: row.token.trim() } };
  }
  if (authType === "apiKey") {
    if (!row.headerName.trim() && !row.apiKey.trim()) return row.hadCredentials ? {} : { error: `${row.method}: header name and API key are required` };
    if (!row.headerName.trim() || !row.apiKey.trim()) return { error: `${row.method}: header name and API key are required` };
    return { credentials: { headerName: row.headerName.trim(), apiKey: row.apiKey.trim() } };
  }
  if (authType === "basic") {
    if (!row.username.trim() && !row.password.trim()) return row.hadCredentials ? {} : { error: `${row.method}: username and password are required` };
    if (!row.username.trim() || !row.password.trim()) return { error: `${row.method}: username and password are required` };
    return { credentials: { username: row.username.trim(), password: row.password.trim() } };
  }
  if (authType === "customHeaders") {
    const valid = row.customHeaders.filter((h) => h.name.trim() && h.value.trim());
    if (valid.length === 0) return row.hadCredentials ? {} : { error: `${row.method}: at least one header is required` };
    return { credentials: Object.fromEntries(valid.map((h) => [h.name.trim(), h.value.trim()])) };
  }
  return { credentials: {} }; // none
}

// ---------------------------------------------------------------------------
// Detail modal: read-only view by default, "Edit configuration" switches to
// the editable per-method form. A not-yet-configured feature has nothing to
// accidentally change yet, so it opens straight into edit mode.
// ---------------------------------------------------------------------------

function WebsiteIntegrationDetailModal({
  api,
  featureKey,
  current,
  onClose,
  onSaved,
}: {
  api: WebsiteIntegrationsApi;
  featureKey: string;
  current: WebsiteIntegrationStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">(current?.configured ? "view" : "edit");

  return (
    <Modal open onClose={onClose} title={`${current?.configured ? "" : "Configure "}${current?.featureLabel ?? featureKey}`}>
      {mode === "view" && current ? (
        <IntegrationReadOnlyView current={current} api={api} featureKey={featureKey} onEdit={() => setMode("edit")} onClose={onClose} />
      ) : (
        <IntegrationEditForm api={api} featureKey={featureKey} current={current} onCancel={() => (current?.configured ? setMode("view") : onClose())} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function IntegrationReadOnlyView({
  current,
  api,
  featureKey,
  onEdit,
  onClose,
}: {
  current: WebsiteIntegrationStatus;
  api: WebsiteIntegrationsApi;
  featureKey: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const rows = deriveMethodRows(current);
  const hasAdvanced = Boolean(current.fieldMapping || current.responseMapping || current.lookupKey || current.confidentialFields.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Base URL</p>
        <p className="mt-0.5 break-all text-sm text-neutral-800">{current.baseUrl}</p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Business Admin permission</p>
        <p className="mt-0.5 text-sm text-neutral-800">{permissionLabel(current.permissionLevel)}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Methods</p>
        {rows.map((row) => (
          <div key={row.method} className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2 text-xs">
            <span className="w-14 shrink-0 font-mono font-semibold text-neutral-700">{row.method}</span>
            <span className="min-w-0 flex-1 truncate text-neutral-600" title={row.url || conventionUrl(row.method, current.baseUrl ?? "", current.lookupKey)}>
              {row.url || conventionUrl(row.method, current.baseUrl ?? "", current.lookupKey)}
            </span>
            <span className="shrink-0 text-neutral-500">
              {row.authType === "default" ? "Same as GET" : AUTH_TYPE_LABELS[row.authType as AuthType]}
            </span>
            <TestButton onTest={() => api.test(featureKey, resolveTestInput(row, current.baseUrl ?? "", current.lookupKey))} />
          </div>
        ))}
      </div>

      {hasAdvanced && (
        <Collapsible label="Advanced">
          <div className="space-y-3 text-xs text-neutral-600">
            {current.fieldMapping && (
              <div>
                <p className="font-medium text-neutral-700">Field mapping</p>
                {Object.entries(current.fieldMapping).map(([k, v]) => (
                  <p key={k} className="flex items-center gap-1">
                    {k} → {v}
                    {current.confidentialFields.includes(k) && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                        title={
                          current.confidentialWriteEnabled.includes(k)
                            ? "Confidential — encrypted at rest, write-back confirmed"
                            : "Confidential — encrypted at rest, read/import only"
                        }
                      >
                        <Lock className="h-2.5 w-2.5" /> Confidential
                      </span>
                    )}
                  </p>
                ))}
              </div>
            )}
            {current.responseMapping && (
              <div>
                <p className="font-medium text-neutral-700">Response path</p>
                {current.responseMapping.listPath && <p>List: {current.responseMapping.listPath}</p>}
                {current.responseMapping.itemPath && <p>Item: {current.responseMapping.itemPath}</p>}
              </div>
            )}
            {current.lookupKey && (
              <div>
                <p className="font-medium text-neutral-700">Lookup key</p>
                <p>
                  Update/Delete address items by <code>{current.lookupKey}</code> (query parameter), not id (path).
                </p>
              </div>
            )}
          </div>
        </Collapsible>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={onEdit}>
          Edit configuration
        </Button>
      </div>
    </div>
  );
}

// Resolves what a Test click should actually send for a row, using
// currently-saved values (view mode has no in-progress edits) — credentials
// omitted so the backend falls back to whatever's already saved for that
// exact method+authType (see testEndpointConnection's fallback logic).
function resolveTestInput(
  row: MethodRowState,
  baseUrl: string,
  lookupKey?: string | null
): { method: HttpMethod; url: string; authType: AuthType } {
  return {
    method: row.method,
    url: row.url || conventionUrl(row.method, baseUrl, lookupKey),
    authType: row.authType === "default" ? "none" : (row.authType as AuthType),
  };
}

// Credentials to send along with an Analyze/Refresh call — reuses
// buildRowCredentials (the same per-row validation the Save flow uses),
// but degrades gracefully: an incomplete/missing credential just omits
// them (backend falls back to whatever's already saved for GET) rather
// than blocking analysis the way a real Save would.
function credentialsForDiscovery(row: MethodRowState): Record<string, string> | undefined {
  if (row.authType === "default" || row.authType === "none") return undefined;
  const built = buildRowCredentials(row);
  return built.credentials && Object.keys(built.credentials).length > 0 ? built.credentials : undefined;
}

function IntegrationEditForm({
  api,
  featureKey,
  current,
  onCancel,
  onSaved,
}: {
  api: WebsiteIntegrationsApi;
  featureKey: string;
  current: WebsiteIntegrationStatus | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>(current?.permissionLevel ?? "VIEW");
  const [rows, setRows] = useState<MethodRowState[]>(() => deriveMethodRows(current));
  const [fieldMappingRows, setFieldMappingRows] = useState<FieldMappingRow[]>(() => fieldMappingRowsFrom(current?.fieldMapping));
  const [dashboardFields, setDashboardFields] = useState<FieldDef[]>(current?.dashboardFields ?? []);
  const [discoveredFields, setDiscoveredFields] = useState<DiscoveredField[] | null>(current?.discoveredSchema ?? null);
  const [previousDiscoveredFields, setPreviousDiscoveredFields] = useState<DiscoveredField[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SchemaSnapshot[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [accessLogOpen, setAccessLogOpen] = useState(false);
  const [accessLog, setAccessLog] = useState<ConnectorAccessLogEntry[] | null>(null);
  const [accessLogLoading, setAccessLogLoading] = useState(false);
  const [customFieldDraft, setCustomFieldDraft] = useState<CustomFieldDraft | null>(null);
  const [listPath, setListPath] = useState(current?.responseMapping?.listPath ?? "");
  const [itemPath, setItemPath] = useState(current?.responseMapping?.itemPath ?? "");
  const [lookupKey, setLookupKey] = useState(current?.lookupKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  // Dashboard field keys flagged Confidential in this mapping session, and
  // the subset explicitly, separately confirmed for write-back (see
  // writeConfirmField below) — both persisted on save.
  const [confidentialFields, setConfidentialFields] = useState<string[]>(current?.confidentialFields ?? []);
  const [confidentialWriteEnabled, setConfidentialWriteEnabled] = useState<string[]>(current?.confidentialWriteEnabled ?? []);
  const [writeConfirmField, setWriteConfirmField] = useState<string | null>(null);

  function toggleConfidential(dashboardField: string) {
    if (!dashboardField) return;
    setConfidentialFields((fs) => (fs.includes(dashboardField) ? fs.filter((f) => f !== dashboardField) : [...fs, dashboardField]));
    // Unmarking Confidential also revokes write-back — it was only ever
    // write-enabled because it was confidential in the first place.
    setConfidentialWriteEnabled((fs) => fs.filter((f) => f !== dashboardField));
  }

  function updateRow(method: HttpMethod, patch: Partial<MethodRowState>) {
    setRows((rs) => rs.map((r) => (r.method === method ? { ...r, ...patch } : r)));
  }

  function addMappingRow() {
    setFieldMappingRows((rs) => [...rs, { dashboardField: "", externalField: "" }]);
  }
  function removeMappingRow(index: number) {
    setFieldMappingRows((rs) => rs.filter((_, i) => i !== index));
  }
  function updateMappingRow(index: number, patch: Partial<FieldMappingRow>) {
    setFieldMappingRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  // "Analyze Endpoint" (first click) / "Refresh Schema" (subsequent clicks
  // — same action, the button just relabels once a schema is already
  // known) — samples the real GET response via the backend's
  // discoverSchema and populates the External Field dropdowns below.
  async function handleAnalyze() {
    const getRow = rows.find((r) => r.method === "GET")!;
    const url = getRow.url || baseUrl;
    if (!url) {
      setAnalyzeError("Enter a Base URL first.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await api.discoverSchema(featureKey, {
        url,
        authType: getRow.authType === "default" ? "none" : (getRow.authType as AuthType),
        credentials: credentialsForDiscovery(getRow),
      });
      setDiscoveredFields(result.fields);
      setPreviousDiscoveredFields(result.previousFields);
      setRecordCount(result.recordCount);
    } catch (err) {
      setAnalyzeError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not analyze this endpoint.") : "Could not analyze this endpoint.");
    } finally {
      setAnalyzing(false);
    }
  }

  // Fetched lazily on first open, not on every modal open — this is a
  // reference/diagnostic view, not something needed for the common
  // "just configure and save" path.
  async function handleToggleHistory() {
    if (!historyOpen && history === null && current) {
      setHistoryLoading(true);
      try {
        setHistory(await api.schemaHistory(featureKey));
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    }
    setHistoryOpen((v) => !v);
  }

  // Same lazy-fetch-on-first-open pattern as schema history.
  async function handleToggleAccessLog() {
    if (!accessLogOpen && accessLog === null && current) {
      setAccessLogLoading(true);
      try {
        setAccessLog(await api.accessLog(featureKey));
      } catch {
        setAccessLog([]);
      } finally {
        setAccessLogLoading(false);
      }
    }
    setAccessLogOpen((v) => !v);
  }

  // "+ Create new field…" — reuses the existing Feature Catalog update
  // endpoint (api/featureCatalog.ts's updateFeatureCatalogEntry) rather
  // than any new field-creation code; the new field is immediately
  // available in the Dashboard Field dropdown and auto-selected for the
  // row that triggered it.
  async function handleCreateCustomField(rowIndex: number) {
    if (!current || !customFieldDraft) return;
    try {
      const newField = buildFieldDef(customFieldDraft);
      const updated = await updateFeatureCatalogEntry(current.featureId, { fields: [...dashboardFields, newField] });
      setDashboardFields(updated.fields);
      updateMappingRow(rowIndex, { dashboardField: newField.key });
      setCustomFieldDraft(null);
      showToast(`"${newField.label}" added to ${current.featureLabel}`);
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not create field.") : "Could not create field.");
    }
  }

  const newlyDiscoveredPaths =
    discoveredFields && previousDiscoveredFields
      ? discoveredFields.filter((f) => !previousDiscoveredFields.some((p) => p.path === f.path)).map((f) => f.path)
      : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const getRow = rows.find((r) => r.method === "GET")!;
    const sharedCreds = buildRowCredentials(getRow);
    if (sharedCreds.error) {
      setError(sharedCreds.error);
      return;
    }

    const endpoints: EndpointInput[] = [];
    for (const row of rows) {
      if (row.method === "GET") {
        if (row.url.trim()) endpoints.push({ method: "GET", url: row.url.trim(), authType: null, credentials: undefined });
        continue;
      }
      const hasUrl = row.url.trim() !== "";
      const hasAuthOverride = row.authType !== "default";
      if (!hasUrl && !hasAuthOverride) continue;

      let epCredentials: Record<string, string> | undefined;
      if (hasAuthOverride) {
        const built = buildRowCredentials(row);
        if (built.error) {
          setError(built.error);
          return;
        }
        epCredentials = built.credentials;
      }
      endpoints.push({
        method: row.method,
        url: row.url.trim(),
        authType: hasAuthOverride ? (row.authType as AuthType) : null,
        credentials: epCredentials,
      });
    }

    const fieldMappingEntries = fieldMappingRows
      .map((row) => [row.dashboardField.trim(), row.externalField.trim()] as const)
      .filter(([d, e]) => d && e);
    const fieldMapping = fieldMappingEntries.length > 0 ? Object.fromEntries(fieldMappingEntries) : null;

    const trimmedListPath = listPath.trim();
    const trimmedItemPath = itemPath.trim();
    const responseMapping = trimmedListPath || trimmedItemPath ? { listPath: trimmedListPath, itemPath: trimmedItemPath } : null;

    setSaving(true);
    try {
      await api.save(featureKey, {
        baseUrl,
        authType: getRow.authType as AuthType,
        credentials: sharedCreds.credentials,
        // `current` is never actually null — the list always includes one
        // entry per feature, with `active: false` as the placeholder for
        // "not yet configured" (see listIntegrationStatuses). So
        // `current?.active ?? true` was silently always false for a
        // FIRST-time save (?? doesn't override an explicit false),
        // creating every new integration disabled and requiring someone to
        // notice and click "Enable" separately. Gate on `configured`
        // instead: a brand-new configuration starts active; an already-
        // configured one being edited keeps whatever active state it had.
        active: current?.configured ? current.active : true,
        permissionLevel,
        fieldMapping,
        responseMapping,
        endpoints,
        lookupKey: lookupKey.trim() || null,
        confidentialFields,
        confidentialWriteEnabled,
      });
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not save integration.") : "Could not save integration.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700">Base URL</label>
        <input
          type="url"
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://example-store.com/api/products"
          className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
        <p className="mt-1 text-xs text-neutral-400">Used as the default URL for every method below unless a row overrides it.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700">Business Admin permission</label>
        <div className="mt-1 flex gap-2">
          {(["VIEW", "MANAGE"] as PermissionLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setPermissionLevel(level)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                permissionLevel === level ? "border-maroon bg-maroon/5 text-maroon" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {permissionLabel(level)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-neutral-700">Methods</label>
        <p className="text-xs text-neutral-400">
          Leave a URL blank to use the default (POST to the base URL; PUT/PATCH/DELETE to <code>base URL/{"{id}"}</code>). For a
          site that needs the id somewhere else (e.g. a query param or a nested path), type a custom URL with a literal{" "}
          <code>{"{id}"}</code> where the item's id should go.
        </p>
        {rows.map((row) => (
          <MethodRowEditor key={row.method} row={row} baseUrl={baseUrl} lookupKey={lookupKey} onChange={(patch) => updateRow(row.method, patch)} api={api} featureKey={featureKey} />
        ))}
      </div>

      <Collapsible label="Advanced">
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-700">Field mapping</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="rounded-lg border border-maroon/40 px-2 py-1 text-xs font-semibold text-maroon hover:bg-maroon/5 disabled:opacity-50"
                >
                  {analyzing ? "Analyzing…" : discoveredFields ? "Refresh Schema" : "Analyze Endpoint"}
                </button>
                <button
                  type="button"
                  onClick={addMappingRow}
                  className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  + Add mapping
                </button>
                {current?.configured && (
                  <button
                    type="button"
                    onClick={handleToggleHistory}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                  >
                    {historyOpen ? "Hide history" : "Schema history"}
                  </button>
                )}
                {current?.configured && (
                  <button
                    type="button"
                    onClick={handleToggleAccessLog}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                  >
                    {accessLogOpen ? "Hide activity" : "Recent activity"}
                  </button>
                )}
              </div>
            </div>
            {historyOpen && <SchemaHistoryList loading={historyLoading} history={history} />}
            {accessLogOpen && <ConnectorAccessLogList loading={accessLogLoading} entries={accessLog} />}
            <p className="mt-1 text-xs text-neutral-400">
              {discoveredFields
                ? "Pick from the fields detected on the last analysis, or add a mapping manually."
                : `Rename dashboard fields to whatever field names this tenant's external API expects — click "Analyze Endpoint" to auto-detect available fields from a real response.`}
            </p>
            {discoveredFields && recordCount !== null && (
              <p className="mt-1 text-xs text-neutral-500">
                Detected {discoveredFields.length} field{discoveredFields.length === 1 ? "" : "s"} across {recordCount} record
                {recordCount === 1 ? "" : "s"} — field names and types only, real values are never shown here.
              </p>
            )}
            {confidentialFields.length > 0 && (
              <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                {confidentialFields.length} field{confidentialFields.length === 1 ? " is" : "s are"} marked Confidential —
                encrypted at rest, hidden from the Data Manager and sync previews, and not written back to the tenant's site
                unless separately confirmed below.
              </p>
            )}
            {analyzeError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {analyzeError}
              </p>
            )}
            {newlyDiscoveredPaths.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
                <span className="font-medium">New fields detected:</span>
                {newlyDiscoveredPaths.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {p}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-2">
              {fieldMappingRows.map((row, index) => {
                const isCreatingCustom = customFieldDraft?.rowIndex === index;
                return (
                  <div key={index}>
                    <div className="flex items-center gap-2">
                      <select
                        value={isCreatingCustom ? "__custom__" : row.dashboardField}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") {
                            const discovered = discoveredFields?.find((f) => f.path === row.externalField);
                            const suggested = discovered ? suggestKeyAndLabel(discovered.path) : { key: "", label: "" };
                            setCustomFieldDraft({
                              rowIndex: index,
                              key: suggested.key,
                              label: suggested.label,
                              type: discovered ? suggestFieldType(discovered.type) : "text",
                            });
                          } else {
                            updateMappingRow(index, { dashboardField: e.target.value });
                          }
                        }}
                        className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                      >
                        <option value="">Dashboard field…</option>
                        {dashboardFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                        <option value="__custom__">+ Create new field…</option>
                      </select>
                      <span className="text-neutral-400">→</span>
                      {discoveredFields ? (
                        <select
                          value={row.externalField}
                          onChange={(e) => updateMappingRow(index, { externalField: e.target.value })}
                          className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                        >
                          <option value="">External field…</option>
                          {discoveredFields.map((f) => (
                            <option key={f.path} value={f.path}>
                              {f.path} ({f.type})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={row.externalField}
                          onChange={(e) => updateMappingRow(index, { externalField: e.target.value })}
                          placeholder="External field (e.g. selling_price, category.name)"
                          className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                        />
                      )}
                      <button type="button" onClick={() => removeMappingRow(index)} aria-label="Remove field mapping" className="text-neutral-400 hover:text-red-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {row.dashboardField && (
                      <div className="mt-1 flex items-center gap-3 pl-0.5">
                        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                          <input
                            type="checkbox"
                            checked={confidentialFields.includes(row.dashboardField)}
                            onChange={() => toggleConfidential(row.dashboardField)}
                          />
                          <Lock className="h-3 w-3" /> Confidential
                        </label>
                        {confidentialFields.includes(row.dashboardField) && permissionLevel === "MANAGE" && (
                          <label className="flex items-center gap-1.5 text-xs text-amber-700">
                            <input
                              type="checkbox"
                              checked={confidentialWriteEnabled.includes(row.dashboardField)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  // Never toggled straight on — opens the
                                  // separate confirm dialog below, which is
                                  // the actual second confirmation.
                                  setWriteConfirmField(row.dashboardField);
                                } else {
                                  setConfidentialWriteEnabled((fs) => fs.filter((f) => f !== row.dashboardField));
                                }
                              }}
                            />
                            Allow write-back to tenant's site
                          </label>
                        )}
                      </div>
                    )}
                    {isCreatingCustom && customFieldDraft && (
                      <CustomFieldDraftForm
                        draft={customFieldDraft}
                        onChange={(patch) => setCustomFieldDraft((d) => (d ? { ...d, ...patch } : d))}
                        onCancel={() => setCustomFieldDraft(null)}
                        onConfirm={() => handleCreateCustomField(index)}
                      />
                    )}
                  </div>
                );
              })}
              {fieldMappingRows.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <Plus className="h-3.5 w-3.5" /> No mapping — dashboard field names are sent as-is.
                </p>
              )}
            </div>
          </div>

          <div>
            <span className="text-sm font-medium text-neutral-700">Response path</span>
            <p className="mt-1 text-xs text-neutral-400">
              Only needed if this site's GET response isn't a bare array or a <code>data</code>/<code>items</code>/
              <code>results</code>/<code>records</code> envelope — those are detected automatically.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600">List path</label>
                <input
                  type="text"
                  value={listPath}
                  onChange={(e) => setListPath(e.target.value)}
                  placeholder="e.g. result.catalog"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-mono focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600">Item path (singleton features)</label>
                <input
                  type="text"
                  value={itemPath}
                  onChange={(e) => setItemPath(e.target.value)}
                  placeholder="e.g. result.contact"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-mono focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700">Lookup key</label>
            <p className="mt-1 text-xs text-neutral-400">
              How Update and Delete address an item on this site. Leave as "Address by id" for a site that expects
              <code> {"{baseUrl}/{id}"}</code> in the URL path (the default). Pick a dashboard field instead for a
              site that looks items up by a value like slug or code — requests will use
              <code> {"{baseUrl}?{field}={value}"}</code>, reading that value fresh from each item's own data every
              time.
            </p>
            <select
              value={lookupKey}
              onChange={(e) => setLookupKey(e.target.value)}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              <option value="">Address by id (path convention — default)</option>
              {dashboardFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({f.key})
                </option>
              ))}
            </select>
          </div>
        </div>
      </Collapsible>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <Modal open={writeConfirmField !== null} onClose={() => setWriteConfirmField(null)} title="Allow write-back for a confidential field?">
        <p className="text-sm text-neutral-600">
          <span className="font-medium text-neutral-900">{writeConfirmField}</span> is marked Confidential. Enabling write-back
          means its value will be sent to this tenant's external site on create/update — separate from, and in addition to,
          the general "Manage" write-access toggle above.
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          This is deliberately a second, explicit step: marking a field Confidential does not itself allow writing it
          anywhere — it stays import/read-only until you confirm here.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setWriteConfirmField(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (writeConfirmField) setConfidentialWriteEnabled((fs) => [...fs, writeConfirmField]);
              setWriteConfirmField(null);
            }}
          >
            Confirm write-back
          </Button>
        </div>
      </Modal>
    </form>
  );
}

function MethodRowEditor({
  row,
  baseUrl,
  lookupKey,
  onChange,
  api,
  featureKey,
}: {
  row: MethodRowState;
  baseUrl: string;
  lookupKey?: string | null;
  onChange: (patch: Partial<MethodRowState>) => void;
  api: WebsiteIntegrationsApi;
  featureKey: string;
}) {
  const isGet = row.method === "GET";
  const authOptions: AuthChoice[] = isGet ? ["none", "bearer", "apiKey", "basic", "customHeaders"] : ["default", "none", "bearer", "apiKey", "basic", "customHeaders"];
  const canTest = isGet || row.method === "POST" || row.url.trim() !== "";
  const authLabel = (choice: AuthChoice) => (choice === "default" ? "Same as GET" : AUTH_TYPE_LABELS[choice as AuthType]);

  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 shrink-0 rounded-md bg-neutral-100 px-2 py-1 text-center font-mono text-xs font-semibold text-neutral-700">{row.method}</span>
        <input
          type="text"
          value={row.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder={conventionUrl(row.method, baseUrl, lookupKey)}
          className="min-w-[10rem] flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
        <select
          value={row.authType}
          onChange={(e) => onChange({ authType: e.target.value as AuthChoice })}
          className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
        >
          {authOptions.map((opt) => (
            <option key={opt} value={opt}>
              {authLabel(opt)}
            </option>
          ))}
        </select>
        <TestButton
          onTest={() => api.test(featureKey, resolveTestInput(row, baseUrl, lookupKey))}
          disabledReason={canTest ? undefined : "Set an endpoint URL to test this method"}
        />
      </div>

      {row.authType === "bearer" && (
        <input
          type="password"
          value={row.token}
          onChange={(e) => onChange({ token: e.target.value })}
          placeholder={row.hadCredentials ? "Leave blank to keep current token" : "Token"}
          className="mt-2 w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs"
        />
      )}
      {row.authType === "apiKey" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={row.headerName}
            onChange={(e) => onChange({ headerName: e.target.value })}
            placeholder={row.hadCredentials ? "Keep current" : "Header name"}
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs"
          />
          <input
            type="password"
            value={row.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder={row.hadCredentials ? "Keep current" : "API key"}
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs"
          />
        </div>
      )}
      {row.authType === "basic" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={row.username}
            onChange={(e) => onChange({ username: e.target.value })}
            placeholder={row.hadCredentials ? "Keep current" : "Username"}
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs"
          />
          <input
            type="password"
            value={row.password}
            onChange={(e) => onChange({ password: e.target.value })}
            placeholder={row.hadCredentials ? "Keep current" : "Password"}
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs"
          />
        </div>
      )}
      {row.authType === "customHeaders" && (
        <CustomHeaderFields
          rows={row.customHeaders}
          hadExisting={row.hadCredentials}
          onAdd={() => onChange({ customHeaders: [...row.customHeaders, { name: "", value: "" }] })}
          onRemove={(index) => onChange({ customHeaders: row.customHeaders.filter((_, i) => i !== index) })}
          onUpdate={(index, patch) => onChange({ customHeaders: row.customHeaders.map((h, i) => (i === index ? { ...h, ...patch } : h)) })}
        />
      )}
    </div>
  );
}
