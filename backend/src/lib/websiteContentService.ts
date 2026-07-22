import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { callWebsiteApi, fetchWebsiteApi, fetchWebsiteApiSingle, type WebsiteApiImportFilters } from "./websiteApiClient";
import { ensureSlug } from "./slugify";
import { getFeatureByKey, type FeatureDefinition } from "./featureCatalog";
import { logger } from "./logger";
import { encryptField, decryptField } from "./piiCrypto";
import { logConnectorAccess } from "./connectorAccessLog";
import { buildCredentialRefresher, reconcileCredentialStatus, ensureFreshToken } from "./connectorLogin";
import { detectImageFieldKeys, syncMediaFields, parseMediaUploads, serializeMediaUploads } from "./mediaSync";

// Shared by both the Business-Admin router (routes/websiteContent.ts,
// tenantId from the JWT) and the Super-Admin router
// (routes/superAdminWebsiteContent.ts, tenantId from the URL) — same
// create/update/delete/import behavior either way, only the caller's
// tenant-id source and permission guard differ. Feature identity is
// resolved via lib/featureCatalog.ts's (cached) Feature catalog rather
// than a hardcoded content-type enum — this is what lets Super Admin add
// unlimited custom features with zero code changes here.

// Standardized admin GET/import query filters — same shape validated the
// same way regardless of which router (Business Admin or Super Admin)
// receives them. See WebsiteApiImportFilters for what each means.
export const importFiltersSchema = z
  .object({
    slug: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    collection: z.string().trim().min(1).optional(),
    featured: z.boolean().optional(),
    position: z.number().optional(),
    code: z.string().trim().min(1).optional(),
  })
  .optional();

// Confidential dashboard field keys are never included in a read response
// — not masked, not hinted, just absent — matching the spec's "never shown
// in the Data Manager table UI, never included in sync previews" rule.
// Unlike Customer PII there's no per-field Reveal action for these: the
// spec explicitly also says "never logged", so there's no audit trail this
// could safely feed into.
export function serializeItem(item: { payload: string; [key: string]: unknown }, confidentialFields: string[] = []) {
  const payload = JSON.parse(item.payload) as Record<string, unknown>;
  for (const key of confidentialFields) {
    delete payload[key];
  }
  return { ...item, payload };
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function getConfidentialFields(integration: { confidentialFields: string | null }): string[] {
  return parseStringArray(integration.confidentialFields);
}

function getConfidentialWriteEnabled(integration: { confidentialWriteEnabled: string | null }): string[] {
  return parseStringArray(integration.confidentialWriteEnabled);
}

// Applied right before a payload is persisted to WebsiteContentItem —
// confidential field values are encrypted at rest (same AES-256-GCM
// utility/key as Customer PII, lib/piiCrypto.ts) rather than stored plain,
// even though they're never read back out through the normal serialize
// path. Non-string values are stringified first since encryptField only
// takes strings; this loses the original type on the (never-exposed)
// stored value, which is fine — nothing decrypts these for display.
function encryptConfidentialFields(payload: Record<string, unknown>, confidentialFields: string[]): Record<string, unknown> {
  if (confidentialFields.length === 0) return payload;
  const out = { ...payload };
  for (const key of confidentialFields) {
    if (key in out && out[key] !== null && out[key] !== undefined) {
      out[key] = encryptField(String(out[key]));
    }
  }
  return out;
}

// Counterpart to encryptConfidentialFields, needed only where a payload
// that was already stored (and therefore already encrypted) is about to be
// re-processed through the same push functions — e.g. a "Sync Now" retry
// re-reading a pending/failed item's stored payload (see syncItems).
// Without this, a retry would encrypt already-encrypted ciphertext again
// on save, and send that double-ciphertext to the external site on any
// write-enabled confidential field.
function decryptConfidentialFields(payload: Record<string, unknown>, confidentialFields: string[]): Record<string, unknown> {
  if (confidentialFields.length === 0) return payload;
  const out = { ...payload };
  for (const key of confidentialFields) {
    if (typeof out[key] === "string") {
      try {
        out[key] = decryptField(out[key] as string);
      } catch {
        // Not actually ciphertext — e.g. this field was only just marked
        // Confidential and this row predates that. Leave it as stored.
      }
    }
  }
  return out;
}

// Applied to the payload actually sent to the tenant's external site on
// create/update — a field marked Confidential is excluded from write-back
// unless it also appears in confidentialWriteEnabled (the second, explicit
// confirmation required separately from the feature's general MANAGE
// write-enable toggle). This is the real enforcement point; the frontend's
// confirmation dialog is just how a field gets onto that list in the first
// place.
function stripNonWriteEnabledConfidential(
  payload: Record<string, unknown>,
  confidentialFields: string[],
  confidentialWriteEnabled: string[]
): Record<string, unknown> {
  if (confidentialFields.length === 0) return payload;
  const writeEnabled = new Set(confidentialWriteEnabled);
  const out = { ...payload };
  for (const key of confidentialFields) {
    if (!writeEnabled.has(key)) delete out[key];
  }
  return out;
}

async function logAudit(actorId: string, action: string, tenantId: string, details: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { actorId, action, targetTenantId: tenantId, details: JSON.stringify(details) },
  });
}

export type ActiveIntegration = Prisma.WebsiteIntegrationGetPayload<{ include: { endpoints: true } }> & {
  feature: FeatureDefinition;
};

export async function getActiveIntegration(tenantId: string, featureKey: string): Promise<ActiveIntegration | null> {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) return null;
  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId, featureId: feature.id } }, // tenant-scoped
    include: { endpoints: true },
  });
  if (!integration?.active) return null;
  return { ...integration, feature };
}

export type SyncStatusCounts = { synced: number; pending: number; failed: number; total: number };

// Backs the "Sync Status" column on the Website Modules dashboard (both
// Business Admin's read-only view and Super Admin's) — a per-feature
// breakdown of how many locally-mirrored items are synced vs. still
// pending/failed, distinct from `lastImportedAt` (which only reflects the
// most recent full import, not day-to-day push/retry activity).
export async function getSyncStatusCounts(tenantId: string, featureIds: string[]): Promise<Map<string, SyncStatusCounts>> {
  const map = new Map<string, SyncStatusCounts>(featureIds.map((id) => [id, { synced: 0, pending: 0, failed: 0, total: 0 }]));
  if (featureIds.length === 0) return map;

  const rows = await prisma.websiteContentItem.groupBy({
    by: ["featureId", "syncStatus"],
    where: { tenantId, featureId: { in: featureIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    const counts = map.get(row.featureId);
    if (!counts) continue;
    const n = row._count._all;
    if (row.syncStatus === "synced") counts.synced = n;
    else if (row.syncStatus === "pending") counts.pending = n;
    else if (row.syncStatus === "failed") counts.failed = n;
    counts.total += n;
  }
  return map;
}

export type ListItemsOptions = { search?: string; page?: number; pageSize?: number };
export type ListItemsResult = { items: ReturnType<typeof serializeItem>[]; total: number; page: number; pageSize: number };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Search is a plain substring match over the JSON-stringified payload —
// filter-then-paginate in application code, same pattern already used by
// routes/customers.ts. Fine at boutique data scale; avoids SQLite/Postgres
// JSON-query portability issues a DB-level search would introduce. Takes
// the full integration (not just featureId) so it knows which fields to
// redact before returning — confidential values are ciphertext in the raw
// payload at this point anyway, so they never match a search term, but the
// caller still needs `integration` in scope to call this, and callers
// already have it (they resolve it via getActiveIntegration first).
export async function listItems(
  tenantId: string,
  integration: ActiveIntegration,
  options: ListItemsOptions = {}
): Promise<ListItemsResult> {
  const all = await prisma.websiteContentItem.findMany({
    where: { tenantId, featureId: integration.featureId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
  });

  const search = options.search?.trim().toLowerCase();
  const filtered = search ? all.filter((item) => item.payload.toLowerCase().includes(search)) : all;

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const start = (page - 1) * pageSize;

  const confidentialFields = getConfidentialFields(integration);
  return {
    items: filtered.slice(start, start + pageSize).map((item) => serializeItem(item, confidentialFields)),
    total: filtered.length,
    page,
    pageSize,
  };
}

// Logged right after the local row is written — the final link in the
// chain from outbound request (see callWebsiteApi's own "sync outcome" log)
// through to what actually landed in the dashboard database, so a support
// question like "why is this item synced with no externalId" is answerable
// by grepping one tenantId/itemId across both log lines.
function logSyncStatus(
  tenantId: string,
  featureKey: string,
  item: { id: string; externalId: string | null; syncStatus: string; lastError: string | null }
) {
  logger.info(
    {
      websiteContentSyncStatus: {
        tenantId,
        featureKey,
        itemId: item.id,
        externalId: item.externalId,
        syncStatus: item.syncStatus,
        lastError: item.lastError,
      },
    },
    "website integration: local item sync status"
  );
}

async function pushCreate(tenantId: string, integration: ActiveIntegration, data: Record<string, unknown>, actorId: string | null) {
  const payload = ensureSlug(data, integration.feature.fields);
  const confidentialFields = getConfidentialFields(integration);
  const fresh = await ensureFreshToken(integration, tenantId, actorId);
  const refresher = buildCredentialRefresher(fresh, tenantId, actorId);

  // Detects this feature's image-type fields (generic — see
  // lib/mediaSync.ts, no feature/field name ever hardcoded) and, when any
  // carry a local /uploads/... path, uploads them to the tenant's
  // destination site BEFORE this record is ever pushed. A feature with no
  // image field is a zero-cost no-op — mediaResult.payload === payload.
  const mediaResult = await syncMediaFields({
    tenantId,
    contentType: integration.feature.key,
    integration: fresh,
    imageFieldKeys: detectImageFieldKeys(integration.feature.fields),
    payload,
    existingMediaUploads: {}, // brand-new item — nothing cached yet
    credentialRefresher: refresher,
  });

  if (!mediaResult.ok) {
    // Per spec: an image-upload failure means this record is never sent at
    // all — not even attempted — unlike a JSON-push failure below, which
    // still reaches the external site's create endpoint.
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "SYNC_EXPORT",
      outcome: "failure",
      details: { method: "POST", note: "image_upload_failed" },
    });
    const failedItem = await prisma.websiteContentItem.create({
      data: {
        tenantId,
        featureId: integration.featureId,
        externalId: null,
        payload: JSON.stringify(encryptConfidentialFields(payload, confidentialFields)),
        syncStatus: "failed",
        lastError: mediaResult.error,
        lastSyncedAt: null,
        mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
      },
    });
    logSyncStatus(tenantId, integration.feature.key, failedItem);
    return failedItem;
  }

  const outgoingPayload = stripNonWriteEnabledConfidential(mediaResult.payload, confidentialFields, getConfidentialWriteEnabled(integration));
  const result = await callWebsiteApi(fresh, "POST", null, outgoingPayload, { tenantId, contentType: integration.feature.key }, refresher);
  await reconcileCredentialStatus(integration.id, fresh.credentialStatus, result.status);
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "SYNC_EXPORT",
    outcome: result.success ? "success" : "failure",
    details: { method: "POST" },
  });
  // result.success is only ever true here when callWebsiteApi actually
  // extracted an externalId from the response (see its own comment) — so
  // "synced" and "externalId: null" can no longer both be true at once.
  const item = await prisma.websiteContentItem.create({
    data: {
      tenantId, // tenant-scoped
      featureId: integration.featureId,
      externalId: result.externalId ?? null,
      // Local payload always keeps the LOCAL /uploads/... path — only the
      // outbound copy sent above ever carries the destination URL. This is
      // what keeps the dashboard's own edit form/thumbnail working and lets
      // future syncs detect "unchanged" by comparing local paths.
      payload: JSON.stringify(encryptConfidentialFields(payload, confidentialFields)),
      syncStatus: result.success ? "synced" : "failed",
      lastError: result.error ?? null,
      lastSyncedAt: result.success ? new Date() : null,
      mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
    },
  });
  logSyncStatus(tenantId, integration.feature.key, item);
  return item;
}

// Retries a create for a local item that failed to push the first time
// (syncStatus "failed", externalId still null) — unlike pushCreate, this
// updates the existing local row in place rather than creating a new one,
// so the item keeps its id across retries (see syncItems).
async function pushRetryCreate(
  tenantId: string,
  integration: ActiveIntegration,
  existingItem: { id: string; mediaUploads: string | null },
  data: Record<string, unknown>,
  actorId: string | null
) {
  const payload = ensureSlug(data, integration.feature.fields);
  const confidentialFields = getConfidentialFields(integration);
  const fresh = await ensureFreshToken(integration, tenantId, actorId);
  const refresher = buildCredentialRefresher(fresh, tenantId, actorId);

  const mediaResult = await syncMediaFields({
    tenantId,
    contentType: integration.feature.key,
    itemId: existingItem.id,
    integration: fresh,
    imageFieldKeys: detectImageFieldKeys(integration.feature.fields),
    payload,
    // A prior attempt may already have uploaded some of this item's images
    // successfully (even if the JSON push itself then failed) — reusing
    // that cache is what makes a retry never re-upload an unchanged image.
    existingMediaUploads: parseMediaUploads(existingItem.mediaUploads),
    credentialRefresher: refresher,
  });

  if (!mediaResult.ok) {
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "SYNC_EXPORT",
      outcome: "failure",
      details: { method: "POST", retry: true, note: "image_upload_failed" },
    });
    const failedItem = await prisma.websiteContentItem.update({
      where: { id: existingItem.id },
      data: {
        payload: JSON.stringify(encryptConfidentialFields(payload, confidentialFields)),
        externalId: null,
        syncStatus: "failed",
        lastError: mediaResult.error,
        mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
      },
    });
    logSyncStatus(tenantId, integration.feature.key, failedItem);
    return failedItem;
  }

  const outgoingPayload = stripNonWriteEnabledConfidential(mediaResult.payload, confidentialFields, getConfidentialWriteEnabled(integration));
  const result = await callWebsiteApi(
    fresh,
    "POST",
    null,
    outgoingPayload,
    {
      tenantId,
      contentType: integration.feature.key,
      itemId: existingItem.id,
    },
    refresher
  );
  await reconcileCredentialStatus(integration.id, fresh.credentialStatus, result.status);
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "SYNC_EXPORT",
    outcome: result.success ? "success" : "failure",
    details: { method: "POST", retry: true },
  });
  const item = await prisma.websiteContentItem.update({
    where: { id: existingItem.id },
    data: {
      payload: JSON.stringify(encryptConfidentialFields(payload, confidentialFields)),
      externalId: result.externalId ?? null,
      syncStatus: result.success ? "synced" : "failed",
      lastError: result.error ?? null,
      lastSyncedAt: result.success ? new Date() : undefined,
      mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
    },
  });
  logSyncStatus(tenantId, integration.feature.key, item);
  return item;
}

async function pushUpdate(
  tenantId: string,
  integration: ActiveIntegration,
  existingItem: { id: string; externalId: string | null; mediaUploads: string | null },
  data: Record<string, unknown>,
  actorId: string | null
) {
  const payload = ensureSlug(data, integration.feature.fields);
  // PATCH only if Super Admin explicitly configured a PATCH endpoint for
  // this feature — PUT remains the default update verb otherwise.
  const updateMethod = integration.endpoints.some((e) => e.method === "PATCH") ? "PATCH" : "PUT";
  const fresh = await ensureFreshToken(integration, tenantId, actorId);
  const refresher = buildCredentialRefresher(fresh, tenantId, actorId);

  const mediaResult = await syncMediaFields({
    tenantId,
    contentType: integration.feature.key,
    itemId: existingItem.id,
    integration: fresh,
    imageFieldKeys: detectImageFieldKeys(integration.feature.fields),
    payload,
    existingMediaUploads: parseMediaUploads(existingItem.mediaUploads),
    credentialRefresher: refresher,
  });

  if (!mediaResult.ok) {
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "SYNC_EXPORT",
      outcome: "failure",
      details: { method: updateMethod, note: "image_upload_failed" },
    });
    const failedItem = await prisma.websiteContentItem.update({
      where: { id: existingItem.id },
      data: {
        payload: JSON.stringify(payload),
        syncStatus: "failed",
        lastError: mediaResult.error,
        mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
      },
    });
    logSyncStatus(tenantId, integration.feature.key, failedItem);
    return failedItem;
  }

  const result = await callWebsiteApi(
    fresh,
    updateMethod,
    existingItem.externalId,
    mediaResult.payload,
    {
      tenantId,
      contentType: integration.feature.key,
      itemId: existingItem.id,
    },
    refresher
  );
  await reconcileCredentialStatus(integration.id, fresh.credentialStatus, result.status);
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "SYNC_EXPORT",
    outcome: result.success ? "success" : "failure",
    details: { method: updateMethod },
  });
  const item = await prisma.websiteContentItem.update({
    where: { id: existingItem.id },
    data: {
      payload: JSON.stringify(payload),
      syncStatus: result.success ? "synced" : "failed",
      lastError: result.error ?? null,
      lastSyncedAt: result.success ? new Date() : undefined,
      mediaUploads: serializeMediaUploads(mediaResult.mediaUploads),
    },
  });
  logSyncStatus(tenantId, integration.feature.key, item);
  return item;
}

export type CreateResult =
  | { ok: true; item: ReturnType<typeof serializeItem> }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 502; error: string; item: ReturnType<typeof serializeItem> };

export async function createItem(
  tenantId: string,
  featureKey: string,
  data: Record<string, unknown>,
  actorId: string
): Promise<CreateResult> {
  const integration = await getActiveIntegration(tenantId, featureKey);
  if (!integration) {
    return { ok: false, status: 404, error: "This feature isn't enabled for your business." };
  }

  // Singleton features (e.g. Contact Details) update the existing record
  // instead of accumulating duplicates.
  if (integration.feature.isSingleton) {
    const existing = await prisma.websiteContentItem.findFirst({ where: { tenantId, featureId: integration.featureId } });
    if (existing) {
      const updated = await pushUpdate(tenantId, integration, existing, data, actorId);
      await logAudit(actorId, "FEATURE_ITEM_UPDATED", tenantId, { featureKey, itemId: updated.id, syncStatus: updated.syncStatus });
      return updated.syncStatus === "synced"
        ? { ok: true, item: serializeItem(updated, getConfidentialFields(integration)) }
        : { ok: false, status: 502, error: updated.lastError ?? "Sync failed", item: serializeItem(updated, getConfidentialFields(integration)) };
    }
  }

  const item = await pushCreate(tenantId, integration, data, actorId);
  await logAudit(actorId, "FEATURE_ITEM_CREATED", tenantId, { featureKey, itemId: item.id, syncStatus: item.syncStatus });
  return item.syncStatus === "synced"
    ? { ok: true, item: serializeItem(item, getConfidentialFields(integration)) }
    : { ok: false, status: 502, error: item.lastError ?? "Sync failed", item: serializeItem(item, getConfidentialFields(integration)) };
}

export type MutateResult =
  | { ok: true; item: ReturnType<typeof serializeItem> }
  | { ok: false; status: 404 }
  | { ok: false; status: 502; error: string; item: ReturnType<typeof serializeItem> };

export async function updateItem(
  tenantId: string,
  featureKey: string,
  id: string,
  data: Record<string, unknown>,
  actorId: string
): Promise<MutateResult> {
  const integration = await getActiveIntegration(tenantId, featureKey);
  if (!integration) return { ok: false, status: 404 };

  const existing = await prisma.websiteContentItem.findFirst({ where: { id, tenantId, featureId: integration.featureId } }); // tenant-scoped
  if (!existing) return { ok: false, status: 404 };

  // An item with no externalId was never actually created on the external
  // site (its original POST failed and was only ever kept locally as
  // "failed" — see pushCreate) — PATCH/PUT-ing it would address the bare
  // collection URL (no id to append), not a real resource, and 404. It
  // needs the same create-retry pushRetryCreate already uses for exactly
  // this case elsewhere (see syncItems's identical branch), not pushUpdate.
  const updated = existing.externalId
    ? await pushUpdate(tenantId, integration, existing, data, actorId)
    : await pushRetryCreate(tenantId, integration, existing, data, actorId);
  await logAudit(actorId, "FEATURE_ITEM_UPDATED", tenantId, { featureKey, itemId: updated.id, syncStatus: updated.syncStatus });
  return updated.syncStatus === "synced"
    ? { ok: true, item: serializeItem(updated, getConfidentialFields(integration)) }
    : { ok: false, status: 502, error: updated.lastError ?? "Sync failed", item: serializeItem(updated, getConfidentialFields(integration)) };
}

export type DeleteResult = { ok: true } | { ok: false; status: 404 } | { ok: false; status: 502; error: string; item: ReturnType<typeof serializeItem> };

export async function deleteItem(tenantId: string, featureKey: string, id: string, actorId: string): Promise<DeleteResult> {
  const integration = await getActiveIntegration(tenantId, featureKey);
  if (!integration) return { ok: false, status: 404 };

  const existing = await prisma.websiteContentItem.findFirst({ where: { id, tenantId, featureId: integration.featureId } }); // tenant-scoped
  if (!existing) return { ok: false, status: 404 };

  // Same root cause as updateItem's create-retry branch: an item with no
  // externalId was never actually created on the external site (its
  // original POST failed and was only ever kept locally as "failed"), so
  // there's nothing external to delete. Without this check, callWebsiteApi
  // would DELETE the bare collection URL (externalId ? `${base}/${id}` :
  // base) — which happened to 404 (and get treated as "already deleted")
  // against this particular external API, but a bare collection DELETE
  // isn't guaranteed to be that harmless against every API. Just remove
  // the local row — no outbound call at all.
  if (!existing.externalId) {
    await prisma.websiteContentItem.delete({ where: { id: existing.id } }); // tenant-scoped (existence verified above)
    await logAudit(actorId, "FEATURE_ITEM_DELETED", tenantId, { featureKey, itemId: existing.id, syncStatus: "synced", note: "never externally created — local-only delete" });
    return { ok: true };
  }

  // DELETE never sends a body (loggedFetch omits it unconditionally for
  // this method) — the stored payload is passed through anyway so
  // callWebsiteApi can read a configured lookup key's value off it (e.g.
  // payload.slug) to build a query-parameter-addressed request when one is
  // configured; ignored entirely when it isn't (see
  // lib/websiteApiClient.ts's buildLookupQueryUrl).
  const confidentialFields = getConfidentialFields(integration);
  // Decrypted so a lookupKey that happens to be a confidential field still
  // resolves to its real value for the query-parameter address (DELETE
  // itself never sends a body regardless — see comment above).
  const existingPayload = decryptConfidentialFields(JSON.parse(existing.payload) as Record<string, unknown>, confidentialFields);
  if (confidentialFields.length > 0) {
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "CONFIDENTIAL_FIELD_REVEALED",
      outcome: "success",
      details: { reason: "delete_lookup_key_resolution", fields: confidentialFields, itemId: existing.id },
    });
  }
  const freshForDelete = await ensureFreshToken(integration, tenantId, actorId);
  const deleteRefresher = buildCredentialRefresher(freshForDelete, tenantId, actorId);
  const result = await callWebsiteApi(
    freshForDelete,
    "DELETE",
    existing.externalId,
    existingPayload,
    {
      tenantId,
      contentType: integration.feature.key,
      itemId: existing.id,
    },
    deleteRefresher
  );
  await reconcileCredentialStatus(integration.id, freshForDelete.credentialStatus, result.status);
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "SYNC_EXPORT",
    outcome: result.success ? "success" : "failure",
    details: { method: "DELETE" },
  });
  if (!result.success) {
    // Delete failed against the external API — keep the local row (marked
    // failed, with the error) so the admin can see and retry, rather than
    // silently dropping a record the external site still has.
    const updated = await prisma.websiteContentItem.update({
      where: { id: existing.id },
      data: { syncStatus: "failed", lastError: result.error },
    });
    logSyncStatus(tenantId, featureKey, updated);
    await logAudit(actorId, "FEATURE_ITEM_DELETED", tenantId, { featureKey, itemId: existing.id, syncStatus: "failed" });
    return { ok: false, status: 502, error: result.error ?? "Sync failed", item: serializeItem(updated, confidentialFields) };
  }

  await prisma.websiteContentItem.delete({ where: { id: existing.id } }); // tenant-scoped (existence verified above)
  logger.info(
    { websiteContentSyncStatus: { tenantId, featureKey, itemId: existing.id, externalId: existing.externalId, syncStatus: "deleted", lastError: null } },
    "website integration: local item sync status"
  );
  await logAudit(actorId, "FEATURE_ITEM_DELETED", tenantId, { featureKey, itemId: existing.id, syncStatus: "synced" });
  return { ok: true };
}

function extractExternalId(raw: Record<string, unknown>): string | null {
  const id = raw.id ?? raw.externalId;
  return id !== undefined && id !== null ? String(id) : null;
}

function extractSlug(raw: Record<string, unknown>): string | null {
  const slug = raw.slug;
  return typeof slug === "string" && slug.trim() ? slug.trim() : null;
}

function payloadSlug(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return extractSlug(parsed);
  } catch {
    return null;
  }
}

export type ImportResult =
  | { ok: true; imported: number; skipped: number; removed: number; items: ReturnType<typeof serializeItem>[] }
  | { ok: false; status: number; error: string };

// Fetches the tenant's existing website data straight from their own
// external API and upserts it into the local dashboard mirror — matched by
// externalId so re-running an import updates rather than duplicates. When an
// item has no externalId, falls back to matching a local item (that has
// never had one either) by slug, so external APIs that only expose a slug —
// not a stable id — still upsert instead of accumulating duplicates on every
// re-import; a raw item with neither is skipped, since there's nothing
// stable to key an upsert on. Also reconciles deletions: a previously-synced
// local item whose externalId no longer appears in the fetched set is
// removed (it was deleted on the external site) — items still
// `pending`/`failed` (never confirmed synced) are left alone so an import
// can't silently discard local-only work, and slug-matched (externalId-less)
// items are never reconciled this way, since a slug-only feed gives no
// stable signal that an item was actually removed rather than just missing
// an id this round.
export async function importItems(
  tenantId: string,
  featureKey: string,
  actorId: string,
  filters?: WebsiteApiImportFilters
): Promise<ImportResult> {
  const integration = await getActiveIntegration(tenantId, featureKey);
  if (!integration) {
    return { ok: false, status: 404, error: "This feature isn't enabled for your business." };
  }
  const context = { tenantId, contentType: featureKey };

  const confidentialFields = getConfidentialFields(integration);
  const freshForImport = await ensureFreshToken(integration, tenantId, actorId);
  const importRefresher = buildCredentialRefresher(freshForImport, tenantId, actorId);

  if (integration.feature.isSingleton) {
    const result = await fetchWebsiteApiSingle(freshForImport, context, filters, importRefresher);
    await reconcileCredentialStatus(integration.id, freshForImport.credentialStatus, result.status);
    if (!result.success || !result.item) {
      await logConnectorAccess({
        tenantId,
        featureId: integration.featureId,
        websiteIntegrationId: integration.id,
        actorId,
        action: "SYNC_IMPORT",
        outcome: "failure",
        details: { error: (result.error ?? "Import failed").slice(0, 200) },
      });
      return { ok: false, status: 502, error: result.error ?? "Import failed" };
    }
    const existing = await prisma.websiteContentItem.findFirst({ where: { tenantId, featureId: integration.featureId } });
    const externalId = extractExternalId(result.item);
    const data = {
      externalId,
      // Pulled fresh from the external site — never previously encrypted
      // by us, so this is always a first-time encrypt, unlike the retry
      // path in syncItems.
      payload: JSON.stringify(encryptConfidentialFields(result.item, confidentialFields)),
      syncStatus: "synced" as const,
      lastError: null,
      lastSyncedAt: new Date(),
    };
    const saved = existing
      ? await prisma.websiteContentItem.update({ where: { id: existing.id }, data })
      : await prisma.websiteContentItem.create({ data: { tenantId, featureId: integration.featureId, ...data } });
    await prisma.websiteIntegration.update({
      where: { id: integration.id },
      data: { lastImportedAt: new Date(), lastImportRecordCount: 1 },
    });
    await logAudit(actorId, "FEATURE_ITEM_IMPORTED", tenantId, { featureKey, imported: 1, skipped: 0, removed: 0 });
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "SYNC_IMPORT",
      outcome: "success",
      details: { imported: 1, skipped: 0, removed: 0 },
    });
    return { ok: true, imported: 1, skipped: 0, removed: 0, items: [serializeItem(saved, confidentialFields)] };
  }

  const result = await fetchWebsiteApi(freshForImport, context, filters, importRefresher);
  await reconcileCredentialStatus(integration.id, freshForImport.credentialStatus, result.status);
  if (!result.success || !result.items) {
    await logConnectorAccess({
      tenantId,
      featureId: integration.featureId,
      websiteIntegrationId: integration.id,
      actorId,
      action: "SYNC_IMPORT",
      outcome: "failure",
      details: { error: (result.error ?? "Import failed").slice(0, 200) },
    });
    return { ok: false, status: 502, error: result.error ?? "Import failed" };
  }

  // Candidates for the slug fallback below — only items that have never had
  // an externalId, so a slug match can never clobber an item that's already
  // correctly keyed to a different external record.
  const slugCandidates = await prisma.websiteContentItem.findMany({
    where: { tenantId, featureId: integration.featureId, externalId: null },
  });

  const saved = [];
  let skipped = 0;
  const fetchedExternalIds = new Set<string>();
  for (const raw of result.items) {
    const externalId = extractExternalId(raw);
    let existing: (typeof slugCandidates)[number] | null = null;

    if (externalId) {
      fetchedExternalIds.add(externalId);
      existing = await prisma.websiteContentItem.findFirst({ where: { tenantId, featureId: integration.featureId, externalId } });
    } else {
      const slug = extractSlug(raw);
      if (!slug) {
        // Can't key an upsert without a stable external id or slug —
        // surfaced via `skipped` rather than silently dropped, so the
        // caller can tell.
        skipped += 1;
        continue;
      }
      const candidateIndex = slugCandidates.findIndex((c) => payloadSlug(c.payload) === slug);
      if (candidateIndex !== -1) {
        // Consume the match so a second fetched item with the same slug
        // (an upstream data issue, but not ours to silently merge) creates
        // its own row instead of double-matching this one.
        existing = slugCandidates.splice(candidateIndex, 1)[0];
      }
    }

    const data = {
      externalId,
      payload: JSON.stringify(encryptConfidentialFields(raw, confidentialFields)),
      syncStatus: "synced" as const,
      lastError: null,
      lastSyncedAt: new Date(),
    };
    const item = existing
      ? await prisma.websiteContentItem.update({ where: { id: existing.id }, data })
      : await prisma.websiteContentItem.create({ data: { tenantId, featureId: integration.featureId, ...data } });
    saved.push(item);
  }

  // Deletion reconciliation: only unfiltered imports reflect the site's
  // full current set, so only reconcile when no filters narrowed the
  // fetch — otherwise every synced item outside the filter would look
  // "deleted" and get wrongly removed.
  let removed = 0;
  const isUnfiltered = !filters || Object.keys(filters).length === 0;
  if (isUnfiltered) {
    const staleSynced = await prisma.websiteContentItem.findMany({
      where: {
        tenantId,
        featureId: integration.featureId,
        syncStatus: "synced",
        externalId: { not: null, notIn: [...fetchedExternalIds] },
      },
      select: { id: true },
    });
    if (staleSynced.length > 0) {
      await prisma.websiteContentItem.deleteMany({ where: { id: { in: staleSynced.map((i) => i.id) } } });
      removed = staleSynced.length;
    }
  }

  await prisma.websiteIntegration.update({
    where: { id: integration.id },
    data: { lastImportedAt: new Date(), lastImportRecordCount: saved.length },
  });

  // One entry per import batch, not per item — avoids audit-log bloat on a
  // large import.
  await logAudit(actorId, "FEATURE_ITEM_IMPORTED", tenantId, { featureKey, imported: saved.length, skipped, removed });
  await logConnectorAccess({
    tenantId,
    featureId: integration.featureId,
    websiteIntegrationId: integration.id,
    actorId,
    action: "SYNC_IMPORT",
    outcome: "success",
    details: { imported: saved.length, skipped, removed },
  });
  return { ok: true, imported: saved.length, skipped, removed, items: saved.map((item) => serializeItem(item, confidentialFields)) };
}

export type SyncResult =
  | { ok: true; retried: number; retriedFailed: number; import: ImportResult & { ok: true } }
  | { ok: false; status: number; error: string };

// One-click "Sync Now": first retries pushing every local item still
// `pending`/`failed` (never successfully round-tripped, or failed on a
// prior attempt), then runs the same import/upsert/reconcile pass as
// importItems. Together this is the full bidirectional sync a Business
// Admin/Super Admin triggers from the Website Modules dashboard.
export async function syncItems(
  tenantId: string,
  featureKey: string,
  actorId: string
): Promise<SyncResult> {
  const integration = await getActiveIntegration(tenantId, featureKey);
  if (!integration) {
    return { ok: false, status: 404, error: "This feature isn't enabled for your business." };
  }

  const outstanding = await prisma.websiteContentItem.findMany({
    where: { tenantId, featureId: integration.featureId, syncStatus: { in: ["pending", "failed"] } },
  });

  const confidentialFields = getConfidentialFields(integration);
  let retried = 0;
  let retriedFailed = 0;
  for (const item of outstanding) {
    // Decrypt first — item.payload is already-stored (already-encrypted)
    // data, and pushUpdate/pushRetryCreate both encrypt confidential
    // fields themselves, so passing it straight through would encrypt
    // already-encrypted ciphertext again.
    const data = decryptConfidentialFields(JSON.parse(item.payload) as Record<string, unknown>, confidentialFields);
    if (confidentialFields.length > 0) {
      await logConnectorAccess({
        tenantId,
        featureId: integration.featureId,
        websiteIntegrationId: integration.id,
        actorId,
        action: "CONFIDENTIAL_FIELD_REVEALED",
        outcome: "success",
        details: { reason: "sync_retry_reprocess", fields: confidentialFields, itemId: item.id },
      });
    }
    const updated = item.externalId
      ? await pushUpdate(tenantId, integration, item, data, actorId)
      : await pushRetryCreate(tenantId, integration, item, data, actorId);
    retried += 1;
    if (updated.syncStatus !== "synced") retriedFailed += 1;
  }

  const imported = await importItems(tenantId, featureKey, actorId);
  if (!imported.ok) {
    return imported;
  }

  await logAudit(actorId, "FEATURE_ITEM_SYNCED", tenantId, { featureKey, retried, retriedFailed, imported: imported.imported });
  return { ok: true, retried, retriedFailed, import: imported };
}
