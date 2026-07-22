import { useEffect, useState } from "react";
import type { ModuleInfo } from "../api/superAdminWebsite";
import { GenericContentTab, type WebsiteContentApi } from "../pages/tenant/WebsiteGenericContent";

// Module-tab switcher shared by the Business Admin's Website Manager
// (pages/tenant/Website.tsx, bound to their own tenant) and Super Admin's
// per-business content management (pages/super-admin/BusinessDetail.tsx,
// bound to a tenantId) — identical tab/list/edit UI, only which api
// functions get built per feature (and whether writes are allowed) differs.
// Modules (label/fields/isSingleton/canManage) come from the backend's
// dynamic Feature catalog, not a hardcoded list — see api/superAdminWebsite.ts.
export function WebsiteContentManager({
  listModules,
  buildApi,
  forceManage = false,
  emptyMessage,
}: {
  listModules: () => Promise<ModuleInfo[]>;
  buildApi: (featureKey: string) => WebsiteContentApi;
  // Super Admin always has full access regardless of a feature's
  // canManage delegation flag (that flag only gates the Business Admin
  // router) — pass true from that caller instead of relying on canManage.
  forceManage?: boolean;
  emptyMessage: string;
}) {
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    listModules()
      .then((active) => {
        setModules(active);
        setTab((current) => current ?? active[0]?.key ?? null);
      })
      .catch(() => setModules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (modules === null) {
    return <p className="mt-6 text-sm text-neutral-400">Loading…</p>;
  }

  if (modules.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">
        {emptyMessage}
      </div>
    );
  }

  const activeModule = modules.find((m) => m.key === tab) ?? modules[0];

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-1 border-b border-neutral-200">
        {modules.map((m) => (
          <button
            key={m.key}
            onClick={() => setTab(m.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeModule.key === m.key ? "border-maroon text-maroon" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <GenericContentTab
        module={activeModule}
        api={buildApi(activeModule.key)}
        readOnly={!forceManage && !activeModule.canManage}
      />
    </>
  );
}
