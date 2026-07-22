import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  listCustomDevelopmentRequests,
  updateCustomDevelopmentRequest,
  type CustomDevelopmentRequest,
  type RequestStatus,
} from "../../api/superAdminSubscriptions";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";

const STATUSES: RequestStatus[] = ["Requested", "Quoted", "Approved", "InProgress", "Completed", "Invoiced", "Cancelled"];

const SERVICE_TYPE_LABELS: Record<string, string> = {
  UI_CHANGE: "UI / Dashboard Component Changes",
  NEW_MODULE: "New Dashboard Module",
  CUSTOM_WORKFLOW: "Custom Workflow",
  API_INTEGRATION: "Third-party API Integration",
  SCHEMA_CHANGE: "Database Schema Changes",
  CUSTOM_FEATURE: "Custom Website Feature",
  ENTERPRISE_CUSTOM: "Enterprise Custom Development",
};

function statusStyle(status: RequestStatus): string {
  if (status === "Requested") return "bg-neutral-100 text-neutral-600";
  if (status === "Quoted") return "bg-amber-50 text-amber-700";
  if (status === "Approved" || status === "InProgress") return "bg-blue-50 text-blue-700";
  if (status === "Completed" || status === "Invoiced") return "bg-emerald-50 text-emerald-700";
  return "bg-red-50 text-red-700"; // Cancelled
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CustomDevelopmentQueue() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<CustomDevelopmentRequest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomDevelopmentRequest | null>(null);

  async function load() {
    try {
      setRequests(await listCustomDevelopmentRequests(statusFilter || undefined));
    } catch {
      setError("Could not load custom development requests.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="px-8 py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Custom Development</h1>
      <p className="mt-1 text-sm text-neutral-500">Requests across every business — a quote queue, not automated billing.</p>

      <div className="mt-6">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RequestStatus | "")}
          className="rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-6 py-3">Business</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3">Quoted</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Requested</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {requests === null && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-neutral-400">
                  Loading…
                </td>
              </tr>
            )}
            {requests?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-neutral-400">
                  No requests.
                </td>
              </tr>
            )}
            {requests?.map((r) => (
              <tr key={r.id}>
                <td className="px-6 py-4 text-neutral-800">{r.tenant.businessName}</td>
                <td className="px-6 py-4 text-neutral-600">{SERVICE_TYPE_LABELS[r.serviceType] ?? r.serviceType}</td>
                <td className="max-w-xs truncate px-6 py-4 text-neutral-600" title={r.description}>
                  {r.description}
                </td>
                <td className="px-6 py-4 text-neutral-600">{r.quotedAmount !== null ? `₹${r.quotedAmount.toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-6 py-4">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(r.status)}`}>{r.status}</span>
                </td>
                <td className="px-6 py-4 text-neutral-500">{formatDateTime(r.createdAt)}</td>
                <td className="px-6 py-4 text-right">
                  <button type="button" onClick={() => setEditing(r)} className="text-xs font-semibold text-maroon hover:underline">
                    Update
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UpdateRequestModal
        request={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function UpdateRequestModal({
  request,
  onClose,
  onSaved,
}: {
  request: CustomDevelopmentRequest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<RequestStatus>("Requested");
  const [quotedAmount, setQuotedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request) {
      setStatus(request.status);
      setQuotedAmount(request.quotedAmount !== null ? String(request.quotedAmount) : "");
      setNotes(request.notes ?? "");
      setError(null);
    }
  }, [request]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!request) return;
    setSaving(true);
    setError(null);
    try {
      await updateCustomDevelopmentRequest(request.id, {
        status,
        quotedAmount: quotedAmount.trim() ? Number(quotedAmount) : null,
        notes: notes.trim() || null,
      });
      showToast("Request updated.");
      onSaved();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not update request.") : "Could not update request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!request} onClose={onClose} title={request ? `${request.tenant.businessName} — ${SERVICE_TYPE_LABELS[request.serviceType] ?? request.serviceType}` : "Update request"}>
      {request && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Description</p>
            <p className="mt-1 text-sm text-neutral-700">{request.description}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as RequestStatus)}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Quoted amount (₹)</label>
            <input
              type="number"
              min={0}
              value={quotedAmount}
              onChange={(e) => setQuotedAmount(e.target.value)}
              placeholder="Leave blank if not yet quoted"
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700">Internal notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
