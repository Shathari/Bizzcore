// Frontend mirror of backend/src/lib/whatsappPlaceholders.ts — kept manually
// in sync (frontend/backend are separate packages, no shared module between
// them) since it's a handful of static values, not logic. If CustomerField
// or its formatting ever changes, update both files together.
export type CustomerField = "name" | "phone" | "segment" | "totalSpent" | "lastPurchase";

export const CUSTOMER_FIELD_OPTIONS: { value: CustomerField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "segment", label: "Segment" },
  { value: "totalSpent", label: "Total Spent" },
  { value: "lastPurchase", label: "Last Purchase Date" },
];

export type PlaceholderMapping =
  | { index: number; mode: "STATIC"; value: string }
  | { index: number; mode: "CUSTOMER_FIELD"; field: CustomerField };

// Sample-customer shape the preview needs — a subset of api/customers.ts's
// Customer type. `phone` here is deliberately the masked display value
// (e.g. "+9198••••••75"), never the real number: the composer never has the
// real number (the API never sends it), and the preview only needs to give
// the tenant a rough sense of "this is where Phone goes" — the real
// recipient number is substituted server-side at dispatch time.
export type PreviewCustomer = {
  name: string;
  phoneMasked: string;
  segment: string;
  totalSpent: number;
  lastPurchase: string | null;
};

// Mirrors formatCustomerFieldValue in backend/src/lib/whatsappPlaceholders.ts
// (same Intl formatters as Customers.tsx's formatCurrency/formatDate) so the
// preview shown here matches what the recipient's message will actually say.
// Returns null when the field's value is missing on this sample customer —
// callers show that as a warning rather than silently rendering "null"/"—"
// into the previewed message text.
export function formatCustomerFieldValue(field: CustomerField, customer: PreviewCustomer): string | null {
  switch (field) {
    case "name":
      return customer.name;
    case "phone":
      return customer.phoneMasked;
    case "segment":
      return customer.segment;
    case "totalSpent":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
        customer.totalSpent
      );
    case "lastPurchase":
      return customer.lastPurchase
        ? new Date(customer.lastPurchase).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
        : null;
  }
}
