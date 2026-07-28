import { useEffect, useState } from "react";
import axios from "axios";
import { Copy, Instagram, Globe, MessageCircle, UserPlus, Trash2, CalendarClock } from "lucide-react";
import {
  listInquiries,
  updateInquiryStatus,
  deleteInquiry,
  convertInquiryToCustomer,
  INQUIRY_STATUSES,
  type Inquiry,
  type InquiryStatus,
  type InquirySource,
} from "../../api/inquiries";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "../../components/Table";

const STATUS_TABS: Array<{ value: InquiryStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "followed_up", label: "Followed Up" },
  { value: "closed", label: "Closed" },
];

const STATUS_STYLES: Record<InquiryStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  followed_up: "bg-amber-100 text-amber-700",
  closed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<InquiryStatus, string> = {
  open: "Open",
  followed_up: "Followed Up",
  closed: "Closed",
};

const SOURCE_ICON: Record<InquirySource, typeof Globe> = {
  WEBSITE: Globe,
  WHATSAPP: MessageCircle,
  INSTAGRAM: Instagram,
};

const SOURCE_TABS: Array<{ value: InquirySource | "all"; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "WEBSITE", label: "Website" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "INSTAGRAM", label: "Instagram" },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BookingRequests() {
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<InquiryStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<InquirySource | "all">("all");
  const [search, setSearch] = useState("");
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [detailTarget, setDetailTarget] = useState<Inquiry | null>(null);

  async function load() {
    try {
      const data = await listInquiries({
        status: statusFilter === "all" ? undefined : statusFilter,
        source: sourceFilter === "all" ? undefined : sourceFilter,
        search: search || undefined,
      });
      setInquiries(data);
    } catch {
      showToast("Could not load booking requests.", "error");
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter, sourceFilter]);

  useEffect(() => {
    const handle = setTimeout(() => load(), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusFilter/sourceFilter changes are handled by the effect above; this one only debounces `search`
  }, [search]);

  function patchLocal(updated: Inquiry) {
    setInquiries((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
    setDetailTarget((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  async function handleStatusChange(id: string, status: InquiryStatus) {
    try {
      const updated = await updateInquiryStatus(id, status);
      if (statusFilter !== "all" && updated.status !== statusFilter) {
        setInquiries((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
        setDetailTarget(null);
      } else {
        patchLocal(updated);
      }
      showToast("Status updated");
    } catch {
      showToast("Could not update status.", "error");
    }
  }

  async function handleConvert(id: string) {
    try {
      const updated = await convertInquiryToCustomer(id);
      patchLocal(updated);
      showToast(`${updated.customer?.name ?? "Customer"} added to Customers`);
    } catch (err) {
      showToast(axios.isAxiosError(err) ? (err.response?.data?.error ?? "Could not convert to customer.") : "Could not convert to customer.", "error");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteInquiry(id);
      setInquiries((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
      setDetailTarget(null);
      showToast("Booking request deleted");
    } catch {
      showToast("Could not delete this booking request.", "error");
    }
  }

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-serif text-2xl text-neutral-900">Booking Requests</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Requests your customers submit from your website, WhatsApp, or Instagram land here for you to follow up on.
      </p>

      <EmbedSnippetCard />

      <div className="mt-6 flex gap-1 border-b border-neutral-200">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              statusFilter === t.value ? "border-maroon text-maroon" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search name, phone, email, or message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as InquirySource | "all")}
          className="rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
        >
          {SOURCE_TABS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <Table>
          <TableHead>
            <tr>
              <Th></Th>
              <Th>Contact</Th>
              <Th>Message</Th>
              <Th>Preferred</Th>
              <Th>Status</Th>
              <Th>Received</Th>
              <Th></Th>
            </tr>
          </TableHead>
          <TableBody>
            {inquiries === null && (
              <TableRow>
                <Td colSpan={7} className="text-center text-neutral-400">
                  Loading…
                </Td>
              </TableRow>
            )}
            {inquiries?.length === 0 && (
              <TableRow>
                <Td colSpan={7} className="text-center text-neutral-400">
                  No booking requests yet.
                </Td>
              </TableRow>
            )}
            {inquiries?.map((i) => {
              const Icon = SOURCE_ICON[i.source];
              return (
                <TableRow key={i.id} className="cursor-pointer" onClick={() => setDetailTarget(i)}>
                  <Td>
                    <Icon className="h-4 w-4 text-neutral-400" />
                  </Td>
                  <Td>
                    <p className="font-medium text-neutral-900">{i.contactName || i.customer?.name || "Unknown"}</p>
                    <p className="text-xs text-neutral-500">{i.contactPhone || i.customer?.phoneMasked || i.contactEmail || "—"}</p>
                  </Td>
                  <Td className="max-w-xs truncate text-neutral-600">{i.message}</Td>
                  <Td className="text-neutral-600">{i.preferredAt ? formatDateTime(i.preferredAt) : "—"}</Td>
                  <Td>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[i.status]}`}>
                      {STATUS_LABELS[i.status]}
                    </span>
                  </Td>
                  <Td className="text-neutral-500">{formatDateTime(i.createdAt)}</Td>
                  <Td className="text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(i.id);
                      }}
                      className="text-neutral-400 hover:text-red-600"
                      aria-label="Delete booking request"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {detailTarget && (
        <DetailModal
          inquiry={detailTarget}
          onClose={() => setDetailTarget(null)}
          onStatusChange={handleStatusChange}
          onConvert={handleConvert}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function DetailModal({
  inquiry,
  onClose,
  onStatusChange,
  onConvert,
  onDelete,
}: {
  inquiry: Inquiry;
  onClose: () => void;
  onStatusChange: (id: string, status: InquiryStatus) => void;
  onConvert: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [converting, setConverting] = useState(false);

  async function handleConvertClick() {
    setConverting(true);
    try {
      await onConvert(inquiry.id);
    } finally {
      setConverting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Booking Request">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-neutral-900">{inquiry.contactName || inquiry.customer?.name || "Unknown contact"}</p>
          <div className="mt-1 space-y-0.5 text-sm text-neutral-500">
            {(inquiry.contactPhone || inquiry.customer?.phoneMasked) && <p>{inquiry.contactPhone || inquiry.customer?.phoneMasked}</p>}
            {inquiry.contactEmail && <p>{inquiry.contactEmail}</p>}
            {inquiry.preferredAt && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" /> Preferred: {formatDateTime(inquiry.preferredAt)}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800 whitespace-pre-wrap">
          {inquiry.message}
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700">Status</label>
          <select
            value={inquiry.status}
            onChange={(e) => onStatusChange(inquiry.id, e.target.value as InquiryStatus)}
            className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
          >
            {INQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-between gap-3 pt-2">
          <Button variant="danger" onClick={() => onDelete(inquiry.id)}>
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Delete
            </span>
          </Button>
          {!inquiry.customerId && (
            <Button onClick={handleConvertClick} disabled={converting || !inquiry.contactPhone} title={!inquiry.contactPhone ? "Add a phone number to convert" : undefined}>
              <span className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> {converting ? "Converting…" : "Convert to Customer"}
              </span>
            </Button>
          )}
          {inquiry.customerId && <span className="self-center text-xs text-emerald-700">Linked to a customer</span>}
        </div>
      </div>
    </Modal>
  );
}

function EmbedSnippetCard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const tenantId = user?.tenantId ?? "";

  const configuredBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const apiOrigin =
    configuredBase && /^https?:\/\//.test(configuredBase)
      ? configuredBase.replace(/\/?$/, "")
      : `${window.location.origin}${configuredBase ?? "/api"}`;
  const endpoint = `${apiOrigin}/public/inquiries/${tenantId}`;

  const snippet = `fetch("${endpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contactName: "Customer name",
    contactPhone: "+91...",
    contactEmail: "customer@example.com",
    preferredAt: "2026-08-05T15:00:00.000Z",
    message: "Booking request details...",
  }),
});`;

  function handleCopy() {
    navigator.clipboard.writeText(snippet);
    showToast("Snippet copied to clipboard");
  }

  return (
    <Card className="mt-6">
      <h2 className="font-serif text-lg text-neutral-900">Add a booking widget to your website</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Add this call to your site's booking form so submissions show up here automatically. No login or API key needed —
        this endpoint is scoped to your business only.
      </p>
      <div className="relative mt-3">
        <pre className="overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-900 p-4 text-xs text-neutral-100">
          <code>{snippet}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        If your backend is deployed at its own domain, confirm <code className="font-mono">VITE_API_BASE_URL</code> points there so this
        snippet reflects your real public URL.
      </p>
    </Card>
  );
}
