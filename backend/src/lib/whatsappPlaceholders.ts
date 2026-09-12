// Shared shape for how a WhatsApp template broadcast resolves its {{n}}
// placeholders per recipient — used by the broadcast composer (validating
// what the tenant configures), ScheduledContent.placeholderConfig (what gets
// persisted, JSON-encoded per schema.prisma's convention for SQLite parity —
// see that file's header comment), and jobs/scheduler.ts (resolving each
// recipient's actual parameters at dispatch time). Kept here, not duplicated
// in each of those, and written so a future 1:1-conversation template-send
// flow can reuse the same types and CUSTOMER_FIELD_OPTIONS list.

// --- {{n}} extraction ----------------------------------------------------
//
// The one and only {{n}} tokenizer in the codebase — routes/whatsappTemplates.ts
// (validating a template being CREATED against Meta's strict syntax/sequencing/
// placement rules) and this module's own countDistinctVariables below (just
// counting variables in an ALREADY-APPROVED template's body, for the broadcast
// composer) both import it rather than each rolling their own regex.
//
// Deliberately loose ([^}]*, not \d+) so malformed placeholders — {{ 1 }},
// {{name}}, {{1a}} — are still captured as tokens instead of silently
// ignored as plain text; callers that care about strict syntax (see
// validateBodyPlaceholders in routes/whatsappTemplates.ts) check token.inner
// themselves.
const VARIABLE_TOKEN_RE = /\{\{([^}]*)\}\}/g;

export type VariableToken = { raw: string; inner: string; index: number };

export function extractVariableTokens(text: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  let match: RegExpExecArray | null;
  VARIABLE_TOKEN_RE.lastIndex = 0;
  while ((match = VARIABLE_TOKEN_RE.exec(text)) !== null) {
    tokens.push({ raw: match[0], inner: match[1], index: match.index });
  }
  return tokens;
}

// Distinct {{n}} count in a template body Meta has already approved (so its
// variables are guaranteed exactly {{1}}..{{N}} — Meta wouldn't have approved
// it otherwise) — used to size the broadcast composer's placeholder-mapping
// form and to validate a submitted placeholderConfig covers every index.
export function countDistinctVariables(text: string): number {
  const numbers = new Set(extractVariableTokens(text).map((t) => t.inner));
  return numbers.size;
}

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
// (see resolvePlaceholders below, which fails the whole recipient rather
// than sending a blank slot).
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

// --- Dispatch-time resolution ---------------------------------------------
//
// jobs/scheduler.ts's shape for one recipient — a subset of the Customer
// model plus the recipient's already-decrypted phone (dispatch decrypts
// phone once per recipient regardless, for the `to` address; resolving a
// "Phone" placeholder reuses that same value rather than decrypting again).
export type PlaceholderRecipient = {
  name: string;
  segment: string;
  totalSpent: number;
  lastPurchase: Date | null;
  decryptedPhone: string;
};

function rawCustomerFieldValue(field: CustomerField, recipient: PlaceholderRecipient): string | number | Date | null {
  switch (field) {
    case "name":
      return recipient.name;
    case "phone":
      return recipient.decryptedPhone;
    case "segment":
      return recipient.segment;
    case "totalSpent":
      return recipient.totalSpent;
    case "lastPurchase":
      return recipient.lastPurchase;
  }
}

// Resolves one recipient's full ordered bodyParams array from a broadcast's
// placeholderConfig — STATIC entries use their fixed text, CUSTOMER_FIELD
// entries pull and format that recipient's own value. Fails closed: any
// missing CUSTOMER_FIELD value (e.g. no lastPurchase on file) fails the
// whole recipient rather than sending a message with a blank/garbled slot —
// per the "skip + log, never fabricate" decision, the caller (dispatch) is
// expected to skip this recipient and log `missingField` as the reason, not
// retry with a placeholder default.
export function resolvePlaceholders(
  placeholders: PlaceholderMapping[],
  recipient: PlaceholderRecipient
): { ok: true; params: string[] } | { ok: false; missingField: CustomerField } {
  const params: string[] = [];
  // Sorted by index, not array order — placeholderConfig is validated at
  // broadcast-creation time to cover 1..N exactly once, but doesn't
  // guarantee it was stored in that order.
  for (const p of [...placeholders].sort((a, b) => a.index - b.index)) {
    if (p.mode === "STATIC") {
      params.push(p.value);
      continue;
    }
    const formatted = formatCustomerFieldValue(p.field, rawCustomerFieldValue(p.field, recipient));
    if (formatted === null) {
      return { ok: false, missingField: p.field };
    }
    params.push(formatted);
  }
  return { ok: true, params };
}
