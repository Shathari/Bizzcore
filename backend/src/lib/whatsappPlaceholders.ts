// Shared shape for how a WhatsApp template broadcast resolves its {{n}}
// placeholders per recipient — used by the broadcast composer (validating
// what the tenant configures), ScheduledContent.placeholderConfig (what gets
// persisted, JSON-encoded per schema.prisma's convention for SQLite parity —
// see that file's header comment), and jobs/scheduler.ts (resolving each
// recipient's actual parameters at dispatch time). Kept here, not duplicated
// in each of those, and written so a future 1:1-conversation template-send
// flow can reuse the same types and CUSTOMER_FIELD_OPTIONS list.

// The Customer model fields a placeholder can be mapped to. Deliberately a
// narrow, explicit allowlist rather than "any Customer column" — e.g. `phone`
// resolves to the recipient's own real number (safe: it's the same number
// already used as the send target, not a new exposure), while something like
// raw `notes` free text is excluded because it's an internal field never
// meant to reach a customer-facing message.
export type CustomerField = "name" | "phone" | "segment" | "totalSpent" | "lastPurchase";

export const CUSTOMER_FIELD_OPTIONS: { value: CustomerField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "segment", label: "Segment" },
  { value: "totalSpent", label: "Total Spent" },
  { value: "lastPurchase", label: "Last Purchase Date" },
];

export function isCustomerField(value: unknown): value is CustomerField {
  return typeof value === "string" && CUSTOMER_FIELD_OPTIONS.some((opt) => opt.value === value);
}

export type PlaceholderMapping =
  | { index: number; mode: "STATIC"; value: string }
  | { index: number; mode: "CUSTOMER_FIELD"; field: CustomerField };

// Formats a resolved Customer field value the same way the tenant already
// sees it elsewhere in the app (frontend/src/pages/tenant/Customers.tsx's
// formatCurrency/formatDate), so a broadcast reads consistently with the
// dashboard. Returns null for a missing value (null/undefined date, or 0
// totalSpent is a real value, not "missing") — callers decide the fallback
// (see resolveCustomerFieldValue's doc in jobs/scheduler.ts).
export function formatCustomerFieldValue(field: CustomerField, raw: string | number | Date | null): string | null {
  if (raw === null || raw === undefined) return null;
  switch (field) {
    case "totalSpent":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
        raw as number
      );
    case "lastPurchase":
      return new Date(raw as string | Date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    case "name":
    case "phone":
    case "segment":
      return String(raw);
  }
}
