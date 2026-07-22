import { useEffect, useState } from "react";
import axios from "axios";
import { Download, RefreshCw } from "lucide-react";
import type { ModuleInfo } from "../api/superAdminWebsite";
import { useToast } from "./Toast";
import { Button } from "./Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "./Table";

// Read-only "Website Modules" dashboard — shows every feature Super Admin
// has enabled for this tenant, this Business Admin's permission level for
// each, and its sync state. No integration config (base URL, endpoints,
// auth, credentials, field mapping) is ever fetched or shown here — that
// stays exclusively on Super Admin's side (see
// routes/superAdminWebsiteIntegrations.ts). Import/Sync Now are the only
// actions available, and only for features permissioned MANAGE.
export type WebsiteModulesApi = {
  listModules: () => Promise<ModuleInfo[]>;
  importModule: (featureKey: string) => Promise<{ imported: number; skipped: number; removed: number }>;
  syncModule: (featureKey: string) => Promise<{ retried: number; retriedFailed: number; imported: number; skipped: number; removed: number }>;
};

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

function SyncStatusBadges({ counts }: { counts: ModuleInfo["itemCounts"] }) {
  if (counts.total === 0) {
    return <span className="text-xs text-neutral-400">No items yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {counts.synced > 0 && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{counts.synced} synced</span>
      )}
      {counts.pending > 0 && (
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">{counts.pending} pending</span>
      )}
      {counts.failed > 0 && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{counts.failed} failed</span>
      )}
    </div>
  );
}

export function WebsiteModulesPanel({ api }: { api: WebsiteModulesApi }) {
  const { showToast } = useToast();
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    try {
      setModules(await api.listModules());
    } catch {
      showToast("Could not load website modules.", "error");
      setModules([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImport(module: ModuleInfo) {
    setBusyKey(module.key);
    try {
      const res = await api.importModule(module.key);
      showToast(`Imported ${res.imported} item${res.imported === 1 ? "" : "s"} for ${module.label}.`);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Import failed.") : "Import failed.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSync(module: ModuleInfo) {
    setBusyKey(module.key);
    try {
      const res = await api.syncModule(module.key);
      showToast(`Synced ${module.label}: ${res.retried} retried, ${res.imported} imported.`);
      await load();
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Sync failed.") : "Sync failed.", "error");
    } finally {
      setBusyKey(null);
    }
  }

  if (modules === null) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (modules.length === 0) {
    return <p className="text-sm text-neutral-500">No website features are set up for your business yet. Contact Super Admin to have modules configured.</p>;
  }

  return (
    <Table>
      <TableHead>
        <tr>
          <Th>Module</Th>
          <Th>Permission</Th>
          <Th>Import status</Th>
          <Th>Last sync time</Th>
          <Th>Imported records</Th>
          <Th>Sync status</Th>
          <Th></Th>
        </tr>
      </TableHead>
      <TableBody>
        {modules.map((module) => {
          const imported = module.lastImportedAt !== null;
          const busy = busyKey === module.key;
          return (
            <TableRow key={module.key}>
              <Td className="font-medium text-neutral-900">{module.label}</Td>
              <Td>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    module.canManage ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {module.canManage ? "Manage" : "View only"}
                </span>
              </Td>
              <Td className="text-neutral-600">{imported ? "Imported" : "Not yet imported"}</Td>
              <Td className="text-neutral-600">{formatDateTime(module.lastImportedAt)}</Td>
              <Td className="text-neutral-600">{module.lastImportRecordCount ?? "—"}</Td>
              <Td>
                <SyncStatusBadges counts={module.itemCounts} />
              </Td>
              <Td className="text-right">
                {module.canManage ? (
                  imported ? (
                    <Button variant="secondary" onClick={() => handleSync(module)} disabled={busy}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {busy ? "Syncing…" : "Sync now"}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => handleImport(module)} disabled={busy}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {busy ? "Importing…" : "Import"}
                    </Button>
                  )
                ) : (
                  <span className="text-xs text-neutral-400">Contact Super Admin</span>
                )}
              </Td>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
