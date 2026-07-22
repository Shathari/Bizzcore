import { useEffect, useState } from "react";
import { listAuditLog, type AuditLogEntry } from "../../api/superAdmin";
import { auditActionLabel, auditDetailsSummary } from "../../lib/auditLog";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAuditLog()
      .then(setEntries)
      .catch(() => setError("Could not load audit log."));
  }, []);

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Audit Log</h1>
      <p className="mt-1 text-sm text-neutral-500">Every Super Admin action, most recent first.</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-6 py-3">Action</th>
              <th className="px-6 py-3">Business</th>
              <th className="px-6 py-3">Actor</th>
              <th className="px-6 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entries === null && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-neutral-400">
                  Loading…
                </td>
              </tr>
            )}
            {entries?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-neutral-400">
                  No activity yet.
                </td>
              </tr>
            )}
            {entries?.map((entry) => (
              <tr key={entry.id}>
                <td className="px-6 py-4 text-neutral-800">
                  <p>{auditActionLabel(entry.action)}</p>
                  {auditDetailsSummary(entry.details) && (
                    <p className="mt-0.5 text-xs text-neutral-400">{auditDetailsSummary(entry.details)}</p>
                  )}
                </td>
                <td className="px-6 py-4 text-neutral-600">{entry.targetBusinessName ?? "—"}</td>
                <td className="px-6 py-4 text-neutral-600">
                  <p>{entry.actor}</p>
                  <p className="text-xs text-neutral-400">{entry.actorEmail}</p>
                </td>
                <td className="px-6 py-4 text-neutral-500">{formatDateTime(entry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
