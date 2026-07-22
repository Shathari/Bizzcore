import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { WebsiteIntegrationStatus, SchemaSnapshot, ConnectorAccessLogEntry } from "../api/superAdminWebsite";
import { AUTH_TYPE_LABELS, permissionLabel, SchemaHistoryList, ConnectorAccessLogList } from "./WebsiteIntegrationsPanel";

// Super-Admin-only, READ-ONLY: connection health/status visibility into a
// tenant's connectors — no save/test/discoverSchema/remove anywhere in
// this component. Connector configuration is tenant-Admin-owned (see
// WebsiteIntegrationsPanel.tsx, bound to api/connectorConfig.ts from
// pages/tenant/Settings.tsx instead). This is the Super Admin counterpart,
// bound to the read-only api/superAdminWebsite.ts functions from
// pages/super-admin/BusinessDetail.tsx.
export type ConnectionHealthApi = {
  list: () => Promise<WebsiteIntegrationStatus[]>;
  schemaHistory: (featureKey: string) => Promise<SchemaSnapshot[]>;
  accessLog: (featureKey: string) => Promise<ConnectorAccessLogEntry[]>;
};

export function ConnectionHealthPanel({ api }: { api: ConnectionHealthApi }) {
  const [integrations, setIntegrations] = useState<WebsiteIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    api
      .list()
      .then(setIntegrations)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  return (
    <div className="divide-y divide-neutral-100">
      {integrations.map((status) => {
        const open = openKey === status.featureKey;
        return (
          <div key={status.featureKey} className="py-3">
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : status.featureKey)}
              disabled={!status.configured}
              className="flex w-full items-center justify-between text-left disabled:cursor-default"
            >
              <div>
                <p className="text-sm font-medium text-neutral-900">{status.featureLabel}</p>
                {status.configured ? (
                  <p className="text-xs text-neutral-500">
                    {status.baseUrl} · {AUTH_TYPE_LABELS[status.authType]}
                    {!status.active && <span className="ml-2 text-amber-600">Disabled by tenant</span>}
                    {status.active && (
                      <span className={`ml-2 ${status.permissionLevel === "MANAGE" ? "text-emerald-600" : "text-neutral-500"}`}>
                        {permissionLabel(status.permissionLevel)}
                      </span>
                    )}
                    {status.lastImportedAt && (
                      <span className="ml-2 text-neutral-400">
                        Last synced {new Date(status.lastImportedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-400">Not configured by tenant yet</p>
                )}
              </div>
              {status.configured && (
                <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
              )}
            </button>
            {open && status.configured && <ConnectionHealthDetail api={api} featureKey={status.featureKey} />}
          </div>
        );
      })}
      {integrations.length === 0 && <p className="text-sm text-neutral-400">No features in the catalog yet.</p>}
    </div>
  );
}

function ConnectionHealthDetail({ api, featureKey }: { api: ConnectionHealthApi; featureKey: string }) {
  const [historyLoading, setHistoryLoading] = useState(true);
  const [history, setHistory] = useState<SchemaSnapshot[] | null>(null);
  const [logLoading, setLogLoading] = useState(true);
  const [log, setLog] = useState<ConnectorAccessLogEntry[] | null>(null);

  useEffect(() => {
    api
      .schemaHistory(featureKey)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
    api
      .accessLog(featureKey)
      .then(setLog)
      .catch(() => setLog([]))
      .finally(() => setLogLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureKey]);

  return (
    <div className="mt-3 space-y-3 border-l-2 border-neutral-100 pl-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Schema history</p>
        <SchemaHistoryList loading={historyLoading} history={history} />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Connector activity</p>
        <ConnectorAccessLogList loading={logLoading} entries={log} />
      </div>
    </div>
  );
}
