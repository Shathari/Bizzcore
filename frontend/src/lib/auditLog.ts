// Shared between pages/super-admin/AuditLog.tsx (global feed) and
// BusinessDetail.tsx ("Recent activity") — both render the same AuditLog
// rows (see backend/prisma/schema.prisma's AuditLog.action comment for the
// full list of actions ever written), so the label map lives in one place
// rather than drifting between two copies.
const ACTION_LABELS: Record<string, string> = {
  BUSINESS_CREATED: "Business created",
  BUSINESS_SUSPENDED: "Business suspended",
  BUSINESS_REACTIVATED: "Business reactivated",
  CREDENTIALS_RESENT: "Credentials resent",
  // Retired (tenant-wide flag replaced by per-feature permissionLevel) but
  // still shown for historical rows written before the switch.
  WEBSITE_CONTENT_ACCESS_GRANTED: "Website content access granted to Business Admin",
  WEBSITE_CONTENT_ACCESS_REVOKED: "Website content access revoked from Business Admin",
  INTEGRATION_CONFIG_SAVED: "Website integration configured",
  INTEGRATION_CONFIG_DELETED: "Website integration removed",
  FEATURE_CREATED: "Custom feature created",
  FEATURE_UPDATED: "Custom feature updated",
  FEATURE_DELETED: "Custom feature deleted",
  FEATURE_ITEM_CREATED: "Content item created",
  FEATURE_ITEM_UPDATED: "Content item updated",
  FEATURE_ITEM_DELETED: "Content item deleted",
  FEATURE_ITEM_IMPORTED: "Content imported",
  FEATURE_ITEM_SYNCED: "Content synced",
  BUSINESS_UPDATED: "Business details updated",
  BUSINESS_SOFT_DELETED: "Business deleted (recoverable)",
  BUSINESS_RESTORED: "Business restored",
  BUSINESS_PERMANENTLY_DELETED: "Business permanently deleted",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// One-line "what changed" summary from an audit entry's details blob — e.g.
// "featureKey: PRODUCTS · permissionLevel: MANAGE". Skips array/object
// values (like INTEGRATION_CONFIG_SAVED's endpointOverrides) since those
// don't fit a single line; the rest of an audit entry's fields are usually
// scalars (see the various logAudit() call sites), so this stays generic
// rather than needing a per-action formatter — with one exception: the
// { before, after } convention (see routes/super-admin.ts's BUSINESS_UPDATED
// entry) is recognized generically and rendered as a "field: old → new"
// diff of only the fields that actually changed, not a full object dump.
export function auditDetailsSummary(details: Record<string, unknown> | null): string | null {
  if (!details) return null;

  if (isPlainObject(details.before) && isPlainObject(details.after)) {
    const before = details.before;
    const after = details.after;
    const changes = Object.keys(after)
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => `${key}: ${before[key] ?? "—"} → ${after[key] ?? "—"}`);
    return changes.length > 0 ? changes.join(" · ") : null;
  }

  const parts = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .map(([key, value]) => `${key}: ${value}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
