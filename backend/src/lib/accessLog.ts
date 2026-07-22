import { prisma } from "./prisma";

// Every just-in-time decryption of a sensitive Customer field must go
// through here — this is the single write path to AccessLog, so "does this
// table capture every decrypt?" reduces to "does every call site call this?"
// rather than needing to audit scattered ad hoc inserts.

export type PiiField = "phone" | "birthday";

export type AccessReason =
  | "broadcast_send" // WhatsApp broadcast, scheduler.ts — actorId null (system job)
  | "follow_up_call" // Home dashboard "Call" action on a priority follow-up
  | "manual_reveal" // Customer detail view "Reveal" action
  | "birthday_automation" // future birthday-offer trigger — actorId null (system job)
  | "csv_export_with_contact"; // future explicit "export with contact info" action

export async function logAccess(params: {
  tenantId: string;
  actorId: string | null;
  customerId: string;
  field: PiiField;
  reason: AccessReason;
}): Promise<void> {
  await prisma.accessLog.create({ data: params });
}

// A bulk action touches many customers at once (e.g. the contact-info CSV
// export) rather than one — logged as a single row with recordCount instead
// of fanning out one row per customer/field, which would make "how many
// exports happened" and "how many customers were in each" harder to read
// than they need to be. customerId/field stay null, distinguishing this row
// from a per-customer one at read time.
export async function logBulkAccess(params: {
  tenantId: string;
  actorId: string | null;
  reason: AccessReason;
  recordCount: number;
}): Promise<void> {
  await prisma.accessLog.create({
    data: { tenantId: params.tenantId, actorId: params.actorId, reason: params.reason, recordCount: params.recordCount },
  });
}

// Human-readable label for each reason, reused both for the "System (…)"
// fallback below and as the reason column text itself, so the two always
// stay in sync.
export const REASON_LABELS: Record<AccessReason, string> = {
  broadcast_send: "Scheduled broadcast",
  follow_up_call: "Follow-up call",
  manual_reveal: "Manual reveal",
  birthday_automation: "Birthday automation",
  csv_export_with_contact: "CSV export with contact info",
};

export type AccessLogEntry = {
  id: string;
  field: PiiField;
  reason: AccessReason;
  reasonLabel: string;
  actorLabel: string;
  createdAt: Date;
};

// actorId is null for every system/cron-triggered decrypt (broadcast_send,
// birthday_automation) — never render that as blank or "null". Resolves
// actor names in one batch query rather than one lookup per row.
export async function listAccessLogForCustomer(
  tenantId: string,
  customerId: string,
  limit = 20
): Promise<AccessLogEntry[]> {
  const rows = await prisma.accessLog.findMany({
    where: { tenantId, customerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a.name || a.email]));

  return rows.map((r) => ({
    id: r.id,
    field: r.field as PiiField,
    reason: r.reason as AccessReason,
    reasonLabel: REASON_LABELS[r.reason as AccessReason] ?? r.reason,
    actorLabel: r.actorId
      ? (actorById.get(r.actorId) ?? "Unknown user")
      : `System (${REASON_LABELS[r.reason as AccessReason]?.toLowerCase() ?? r.reason})`,
    createdAt: r.createdAt,
  }));
}
