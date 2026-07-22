import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Trash2, Upload, Download, Eye, EyeOff } from "lucide-react";
import {
  listCustomers,
  createCustomer,
  deleteCustomer,
  revealCustomerField,
  getCustomerAccessLog,
  exportCustomers,
  exportCustomersWithContact,
  exportErrorMessage,
  type Customer,
  type Segment,
  type PiiField,
  type AccessLogEntry,
} from "../../api/customers";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";
import { ImportCustomersModal } from "../../components/ImportCustomersModal";

// How long a revealed value stays on screen before auto re-masking.
const REVEAL_DISPLAY_MS = 18_000;

const SEGMENTS: Segment[] = ["Regular", "VIP", "Bridal"];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SegmentBadge({ segment }: { segment: Segment }) {
  const styles: Record<Segment, string> = {
    Regular: "bg-neutral-100 text-neutral-700",
    VIP: "bg-maroon/10 text-maroon",
    Bridal: "bg-gold/20 text-maroon",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[segment]}`}>{segment}</span>;
}

export default function Customers() {
  const { showToast } = useToast();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<Segment | "">("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailTarget, setDetailTarget] = useState<Customer | null>(null);
  const [exporting, setExporting] = useState(false);
  const [contactExportOpen, setContactExportOpen] = useState(false);
  const [contactExporting, setContactExporting] = useState(false);

  async function load(params?: { search?: string; segment?: Segment }) {
    try {
      const data = await listCustomers(params);
      setCustomers(data);
    } catch {
      setError("Could not load customers.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      load({ search: search || undefined, segment: segmentFilter || undefined });
    }, 300);
    return () => clearTimeout(handle);
  }, [search, segmentFilter]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCustomer(deleteTarget.id);
      showToast(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await load({ search: search || undefined, segment: segmentFilter || undefined });
    } catch {
      showToast("Could not delete customer.", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportCustomers();
    } catch (err) {
      showToast(await exportErrorMessage(err, "Could not export customers."), "error");
    } finally {
      setExporting(false);
    }
  }

  async function handleContactExport() {
    setContactExporting(true);
    try {
      await exportCustomersWithContact();
      setContactExportOpen(false);
      showToast("Export with contact info downloaded.");
    } catch (err) {
      showToast(await exportErrorMessage(err, "Could not export contact info."), "error");
    } finally {
      setContactExporting(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-neutral-900">Customers</h1>
          <p className="mt-1 text-sm text-neutral-500">Every customer on file for your business.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <span className="flex items-center gap-2">
              <Upload className="h-4 w-4" /> Import
            </span>
          </Button>
          <Button variant="secondary" onClick={handleExport} disabled={exporting}>
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Export"}
            </span>
          </Button>
          <Button variant="secondary" onClick={() => setContactExportOpen(true)}>
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" /> Export with contact info
            </span>
          </Button>
          <Button onClick={() => setAddOpen(true)}>+ Add Customer</Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
        <select
          value={segmentFilter}
          onChange={(e) => setSegmentFilter(e.target.value as Segment | "")}
          className="rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        >
          <option value="">All segments</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <Table>
          <TableHead>
            <tr>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Segment</Th>
              <Th>Total Spent</Th>
              <Th>Last Purchase</Th>
              <Th></Th>
            </tr>
          </TableHead>
          <TableBody>
            {customers === null && (
              <TableRow>
                <Td colSpan={6} className="text-center text-neutral-400">
                  Loading…
                </Td>
              </TableRow>
            )}
            {customers?.length === 0 && (
              <TableRow>
                <Td colSpan={6} className="text-center text-neutral-400">
                  No customers found.
                </Td>
              </TableRow>
            )}
            {customers?.map((c) => (
              <TableRow key={c.id} onClick={() => setDetailTarget(c)} className="cursor-pointer">
                <Td className="font-medium text-neutral-900">{c.name}</Td>
                <Td className="text-neutral-600">{c.phoneMasked}</Td>
                <Td>
                  <SegmentBadge segment={c.segment} />
                </Td>
                <Td className="text-neutral-600">{formatCurrency(c.totalSpent)}</Td>
                <Td className="text-neutral-600">{formatDate(c.lastPurchase)}</Td>
                <Td className="text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(c);
                    }}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddCustomerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          load({ search: search || undefined, segment: segmentFilter || undefined });
        }}
      />

      <ImportCustomersModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load({ search: search || undefined, segment: segmentFilter || undefined })}
      />

      <CustomerDetailModal customer={detailTarget} onClose={() => setDetailTarget(null)} />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete customer">
        <p className="text-sm text-neutral-600">
          Are you sure you want to delete <span className="font-medium text-neutral-900">{deleteTarget?.name}</span>?
          This can't be undone.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>

      <Modal open={contactExportOpen} onClose={() => setContactExportOpen(false)} title="Export with contact info?">
        <p className="text-sm text-neutral-600">
          This downloads a CSV including every customer's <span className="font-medium text-neutral-900">phone number and
          birthday</span>, decrypted for this file only. The default Export never includes these — use this only when you
          genuinely need contact details outside the dashboard.
        </p>
        <p className="mt-2 text-sm text-neutral-600">This action is logged, including who ran it and how many customers were included.</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setContactExportOpen(false)} disabled={contactExporting}>
            Cancel
          </Button>
          <Button onClick={handleContactExport} disabled={contactExporting}>
            {contactExporting ? "Exporting…" : "Export with contact info"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AddCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState<Segment>("Regular");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetAndClose() {
    setName("");
    setPhone("");
    setEmail("");
    setSegment("Regular");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createCustomer({ name, phone, email: email || undefined, segment });
      resetAndClose();
      onCreated();
    } catch (err) {
      setError(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not add customer.") : "Could not add customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Add Customer">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Name *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Phone *</label>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700">Segment</label>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as Segment)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add Customer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Per-field, per-customer decrypt-on-demand — never available from the
// table, only here. Auto re-masks after REVEAL_DISPLAY_MS, on unmount
// (closing this modal, or switching to a different customer), or when a
// second reveal replaces the timer for the same field.
function RevealableField({
  customerId,
  field,
  label,
  placeholder,
  format,
}: {
  customerId: string;
  field: PiiField;
  label: string;
  placeholder: string;
  format?: (value: string) => string;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-mask immediately if the modal is reused for a different customer,
  // and clear any pending timer on unmount (modal close / navigation away).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [customerId, field]);

  async function handleReveal() {
    setLoading(true);
    try {
      const value = await revealCustomerField(customerId, field);
      setRevealed(value ? (format ? format(value) : value) : "Not on file");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRevealed(null), REVEAL_DISPLAY_MS);
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.status === 429
        ? "Too many reveals — wait a moment and try again."
        : "Could not reveal this field.";
      setRevealed(null);
      window.alert(message); // eslint-disable-line no-alert -- brief, one-off feedback for a rare failure path
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-0.5 text-sm text-neutral-900">{revealed ?? placeholder}</p>
      </div>
      <button
        type="button"
        onClick={handleReveal}
        disabled={loading}
        className="text-neutral-400 hover:text-maroon disabled:opacity-50"
        aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        title={revealed ? `Showing — will re-hide automatically` : `Reveal ${label}`}
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// Read-only audit trail for this customer — who decrypted phone/birthday,
// when, and why. actorLabel is already resolved server-side, including the
// "System (...)" fallback for cron-triggered access (e.g. broadcast sends)
// where there's no acting user — never rendered blank or as "null" here.
function RecentAccessPanel({ customerId }: { customerId: string }) {
  const [entries, setEntries] = useState<AccessLogEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(false);
    getCustomerAccessLog(customerId)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Recent access</p>
      {entries === null && !error && <p className="mt-1 text-sm text-neutral-400">Loading…</p>}
      {error && <p className="mt-1 text-sm text-red-600">Could not load access history.</p>}
      {entries?.length === 0 && <p className="mt-1 text-sm text-neutral-400">No PII access recorded yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-1.5 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.id} className="text-xs text-neutral-600">
              <span className="font-medium capitalize text-neutral-800">{e.field}</span> revealed by{" "}
              <span className="font-medium text-neutral-800">{e.actorLabel}</span> · {e.reasonLabel} ·{" "}
              {formatDateTime(e.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomerDetailModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  return (
    <Modal open={!!customer} onClose={onClose} title={customer?.name ?? "Customer"}>
      {customer && (
        <div className="space-y-3">
          <RevealableField customerId={customer.id} field="phone" label="Phone" placeholder={customer.phoneMasked} />
          <RevealableField
            customerId={customer.id}
            field="birthday"
            label="Birthday"
            placeholder={customer.hasBirthday ? "On file" : "Not on file"}
            format={formatDate}
          />
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Segment</p>
              <p className="mt-0.5"><SegmentBadge segment={customer.segment} /></p>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Email</p>
              <p className="mt-0.5 text-sm text-neutral-900">{customer.email ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Total Spent</p>
              <p className="mt-0.5 text-sm text-neutral-900">{formatCurrency(customer.totalSpent)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Last Purchase</p>
              <p className="mt-0.5 text-sm text-neutral-900">{formatDate(customer.lastPurchase)}</p>
            </div>
          </div>
          {customer.notes && (
            <div className="border-b border-neutral-100 pb-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Notes</p>
              <p className="mt-0.5 text-sm text-neutral-700">{customer.notes}</p>
            </div>
          )}
          <RecentAccessPanel customerId={customer.id} />
        </div>
      )}
    </Modal>
  );
}
