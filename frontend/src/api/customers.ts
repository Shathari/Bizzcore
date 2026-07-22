import axios from "axios";
import { apiClient } from "./client";

export type Segment = "Regular" | "VIP" | "Bridal";

// phone/birthday are never part of this type — the API never sends them.
// phoneMasked is a display-safe hint; hasBirthday only says whether one is
// on file. Use revealCustomerField() to decrypt a specific field on demand.
export type Customer = {
  id: string;
  name: string;
  phoneMasked: string;
  email: string | null;
  segment: Segment;
  hasBirthday: boolean;
  totalSpent: number;
  lastPurchase: string | null;
  notes: string | null;
  createdAt: string;
};

export async function listCustomers(params?: { search?: string; segment?: Segment }): Promise<Customer[]> {
  const { data } = await apiClient.get<Customer[]>("/customers", { params });
  return data;
}

export async function getCustomer(id: string): Promise<Customer> {
  const { data } = await apiClient.get<Customer>(`/customers/${id}`);
  return data;
}

export async function createCustomer(input: {
  name: string;
  phone: string;
  email?: string;
  segment?: Segment;
  birthday?: string;
  totalSpent?: number;
  lastPurchase?: string;
  notes?: string;
}): Promise<Customer> {
  const { data } = await apiClient.post<Customer>("/customers", input);
  return data;
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiClient.delete(`/customers/${id}`);
}

export type PiiField = "phone" | "birthday";

// Deliberate, logged decrypt of a single field — see the customer detail
// view. The caller is responsible for re-masking the returned value in the
// UI after a short display window; the backend only ever returns it once
// per call and never caches it.
export async function revealCustomerField(id: string, field: PiiField): Promise<string | null> {
  const { data } = await apiClient.post<{ value: string | null }>(`/customers/${id}/reveal`, { field });
  return data.value;
}

// Decrypts just the phone number for the Home dashboard's follow-up "Call"
// action — logged under its own AccessLog reason (follow_up_call).
export async function callCustomer(id: string): Promise<string> {
  const { data } = await apiClient.post<{ phone: string }>(`/customers/${id}/call`);
  return data.phone;
}

export type AccessLogEntry = {
  id: string;
  field: PiiField;
  reason: string;
  reasonLabel: string;
  actorLabel: string;
  createdAt: string;
};

// Read-only audit trail — who decrypted this customer's phone/birthday,
// when, and why. actorLabel is already resolved server-side (a system job
// like a scheduled broadcast renders as "System (...)", never blank).
export async function getCustomerAccessLog(id: string): Promise<AccessLogEntry[]> {
  const { data } = await apiClient.get<AccessLogEntry[]>(`/customers/${id}/access-log`);
  return data;
}

export type ImportPreview = {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
};

export async function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ImportPreview>("/customers/import/preview", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export type ImportCommitResult = {
  inserted: number;
  errors: Array<{ row: number; message: string }>;
};

export async function commitImport(
  mapping: Record<string, string | null>,
  rows: Record<string, string>[]
): Promise<ImportCommitResult> {
  const { data } = await apiClient.post<ImportCommitResult>("/customers/import/commit", { mapping, rows });
  return data;
}

// --- CSV export ---------------------------------------------------------
//
// Two distinct actions: the default export never touches phone/birthday;
// exportCustomersWithContact requires the caller to have already gotten an
// explicit confirmation (see the confirm dialog in Customers.tsx) before
// calling it — the backend independently re-validates `confirm: true`
// itself, so this isn't just a frontend-trust boundary.

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// axios still routes a non-2xx response through responseType: "blob" — the
// error body arrives as a Blob, not parsed JSON, so the usual
// `err.response?.data?.error` read doesn't work for these two calls. This
// reads it back out so the UI can still show a real error message (e.g.
// the rate-limit message) instead of a generic fallback.
export async function exportErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await err.response.data.text());
      return typeof parsed?.error === "string" ? parsed.error : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function exportCustomers(): Promise<void> {
  const { data } = await apiClient.get<Blob>("/customers/export", { responseType: "blob" });
  triggerDownload(data, `customers-${Date.now()}.csv`);
}

export async function exportCustomersWithContact(): Promise<void> {
  const { data } = await apiClient.post<Blob>("/customers/export/contact", { confirm: true }, { responseType: "blob" });
  triggerDownload(data, `customers-with-contact-${Date.now()}.csv`);
}
