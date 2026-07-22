import fs from "fs";
import path from "path";
import { fetchWithTimeout, WRITEBACK_TIMEOUT_MS, buildAuthHeaders, type CredentialRefresher } from "./websiteApiClient";
import { UPLOADS_ROOT } from "./upload";
import { logger } from "./logger";
import type { FieldDef } from "./featureCatalog";

// Generic media (image) sync — the one place in the system that ever calls
// a tenant's destination-site upload endpoint. Called from
// lib/websiteContentService.ts's pushCreate/pushUpdate/pushRetryCreate,
// right before the JSON create/update push, for every feature (built-in or
// custom) that has an image-type field — Products, Banners, Gallery, Team,
// a brand-new custom feature, anything. No feature key or field name is
// ever hardcoded here; see detectImageFieldKeys.

export type MediaUploadCacheEntry = { localPath: string; destinationUrl: string };
export type MediaUploadCache = Record<string, MediaUploadCacheEntry>;

export function parseMediaUploads(raw: string | null | undefined): MediaUploadCache {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as MediaUploadCache) : {};
  } catch {
    return {};
  }
}

export function serializeMediaUploads(cache: MediaUploadCache): string {
  return JSON.stringify(cache);
}

// A dashboard field is a "media field" purely because its Feature Catalog
// definition says so (`type: "image"`) — the exact same generic signal
// every existing feature (built-in or custom) already relies on to render
// an upload button in the dashboard (see frontend
// WebsiteGenericContent.tsx). No feature key or field name is ever
// hardcoded, so this works identically for Products, Categories, Banners,
// Gallery, Testimonials, Blog, Team, Events, and any future custom feature
// — and returns [] (a no-op for every caller below) for a feature with no
// image field at all, which is what keeps this fully backward compatible.
export function detectImageFieldKeys(fields: FieldDef[]): string[] {
  return fields.filter((f) => f.type === "image").map((f) => f.key);
}

// Every tenant's destination site now exposes this exact standardized path
// at the same origin as its configured WebsiteIntegration.baseUrl (see
// routes/mockExternalSite.ts's own role as the reference implementation of
// the standardized admin contract) — one shared upload endpoint per tenant
// regardless of which feature is syncing. Derived by convention, not a
// per-tenant/per-feature config field, since it's the same path on every
// site by contract.
const UPLOAD_PATH = "/api/public/admin/uploads";
const UPLOAD_FIELD_NAME = "image";

export function deriveUploadUrl(baseUrl: string): string {
  return new URL(baseUrl).origin + UPLOAD_PATH;
}

function isLocalUploadPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/uploads/");
}

// The standardized contract always returns an absolute URL (e.g.
// "https://tenant-domain/uploads/filename.webp"), but a destination
// implementation that instead returns a root-relative path (e.g.
// "/uploads/filename.webp") is normalized against the upload endpoint's own
// origin before it's ever cached or sent onward — a relative path stored in
// mediaUploads or forwarded in an outbound payload would just reproduce the
// exact bug this whole feature exists to fix (a path with no usable
// domain).
function toAbsoluteDestinationUrl(url: string, uploadUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(uploadUrl).origin;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

// Inverse of lib/upload.ts's publicUrlFor — resolves a stored `/uploads/...`
// dashboard path back to the real file on disk, same convention already
// used by that file's own deleteUploadedFile.
function localPathToFilesystemPath(publicUrl: string): string {
  const relative = publicUrl.replace(/^\/uploads\//, "");
  return path.join(UPLOADS_ROOT, relative);
}

type UploadContext = { tenantId: string; contentType: string; itemId?: string; fieldKey: string };
type UploadImageResult = { ok: true; url: string } | { ok: false; error: string };

// Single attempt — no auto-retry on a network/5xx error. Same reasoning
// lib/websiteApiClient.ts already documents for POST (MAX_ATTEMPTS/
// isAutoRetryableMethod): if a successful upload's response is lost to a
// network blip, blindly retrying risks a second, duplicate file landing on
// the destination, which we'd have no way to detect or clean up. The one
// 401-credential-refresh retry still applies (same `credentialRefresher`
// already built for the JSON push), since that's not ambiguous — a refreshed
// credential retrying the exact same not-yet-accepted request is safe.
async function uploadImageToDestination(
  uploadUrl: string,
  localFilePath: string,
  headers: Record<string, string>,
  context: UploadContext,
  credentialRefresher?: CredentialRefresher
): Promise<UploadImageResult> {
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(localFilePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the local file";
    logger.error({ mediaSync: { ...context, uploadUrl } }, `media sync: local file missing on disk, upload skipped — ${message}`);
    return { ok: false, error: `Local file not found: ${message}` };
  }

  const form = new FormData();
  form.append(UPLOAD_FIELD_NAME, new Blob([fileBuffer]), path.basename(localFilePath));

  logger.info({ mediaSync: { ...context, uploadUrl } }, "media sync: uploading image");

  let resp: Response;
  try {
    // Content-Type deliberately NOT set here — FormData needs to generate
    // its own multipart boundary; setting it manually (as the JSON path
    // does for application/json) would break the encoding.
    resp = await fetchWithTimeout(uploadUrl, { method: "POST", headers, body: form }, WRITEBACK_TIMEOUT_MS);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const message = isTimeout
      ? `Upload timed out after ${Math.round(WRITEBACK_TIMEOUT_MS / 1000)}s — the destination site may be waking up from being idle.`
      : err instanceof Error
        ? err.message
        : "Unknown network error";
    logger.error({ mediaSync: { ...context, uploadUrl } }, `media sync: upload failed (network error) — ${message}`);
    return { ok: false, error: message };
  }

  // Exactly one refresh-and-retry, same as the JSON push path — the retried
  // call passes no refresher, so a 401 on it is final.
  if (resp.status === 401 && credentialRefresher) {
    const refresh = await credentialRefresher();
    if (refresh.refreshed) {
      logger.info({ mediaSync: { ...context, uploadUrl } }, "media sync: 401 received, retrying once with a refreshed credential");
      return uploadImageToDestination(uploadUrl, localFilePath, { ...headers, ...refresh.headers }, context);
    }
    logger.warn({ mediaSync: { ...context, uploadUrl } }, "media sync: 401 received, credential refresh unavailable or failed");
  }

  const rawText = await resp.text().catch(() => "");
  let parsedBody: unknown = null;
  if (rawText) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = null;
    }
  }

  if (!resp.ok) {
    const error = `Upload endpoint returned HTTP ${resp.status}: ${rawText.slice(0, 300)}`;
    logger.error({ mediaSync: { ...context, uploadUrl, status: resp.status } }, `media sync: upload failed — ${error}`);
    return { ok: false, error };
  }

  const rawUrl = parsedBody && typeof parsedBody === "object" ? (parsedBody as Record<string, unknown>).url : undefined;
  if (typeof rawUrl !== "string" || !rawUrl) {
    const error = `Upload endpoint returned a success response but no "url": ${rawText.slice(0, 300)}`;
    logger.error({ mediaSync: { ...context, uploadUrl } }, `media sync: upload failed — ${error}`);
    return { ok: false, error };
  }
  const url = toAbsoluteDestinationUrl(rawUrl, uploadUrl);

  logger.info({ mediaSync: { ...context, uploadUrl, destinationUrl: url } }, "media sync: destination upload success");
  return { ok: true, url };
}

// Just the fields callWebsiteApi/buildAuthHeaders already need — deliberately
// a subset of WebsiteIntegration, not the whole Prisma row, so this stays
// decoupled from the exact shape callers happen to have in scope.
export type MediaSyncIntegrationConfig = {
  baseUrl: string;
  authType: string;
  encryptedCredentials: string | null;
  accessTokenEncrypted?: string | null;
};

export type SyncMediaFieldsParams = {
  tenantId: string;
  contentType: string;
  itemId?: string;
  integration: MediaSyncIntegrationConfig;
  imageFieldKeys: string[];
  payload: Record<string, unknown>;
  existingMediaUploads: MediaUploadCache;
  credentialRefresher?: CredentialRefresher;
};

export type SyncMediaFieldsResult =
  | { ok: true; payload: Record<string, unknown>; mediaUploads: MediaUploadCache }
  | { ok: false; error: string; mediaUploads: MediaUploadCache };

// The orchestrator callers actually use. Returns a NEW payload object with
// image fields swapped to their destination URLs (the caller's original
// payload — what ends up in WebsiteContentItem.payload — is never mutated,
// so the dashboard keeps storing/displaying the local path) and the updated
// upload cache to persist alongside it.
//
// `ok: false` means "do not sync this record" — callers must skip the JSON
// push entirely and mark the item failed with `error` as lastError. The
// `mediaUploads` returned even on failure includes every field that DID
// upload successfully before the one that failed, so a retry never
// re-uploads those.
export async function syncMediaFields(params: SyncMediaFieldsParams): Promise<SyncMediaFieldsResult> {
  const { tenantId, contentType, itemId, integration, imageFieldKeys, payload, existingMediaUploads, credentialRefresher } = params;

  if (imageFieldKeys.length === 0) {
    // This feature has no image-type field at all — zero-cost no-op,
    // byte-identical to sync behavior before this feature existed.
    return { ok: true, payload, mediaUploads: existingMediaUploads };
  }

  const candidateKeys = imageFieldKeys.filter((key) => isLocalUploadPath(payload[key]));
  if (candidateKeys.length === 0) {
    // Has image fields, but none carry a local upload path right now
    // (empty, or already an external URL from a prior import) — nothing to
    // upload.
    return { ok: true, payload, mediaUploads: existingMediaUploads };
  }

  const uploadUrl = deriveUploadUrl(integration.baseUrl);
  const headers = buildAuthHeaders(integration.authType, integration.encryptedCredentials, integration.accessTokenEncrypted ?? null);

  const nextPayload = { ...payload };
  const nextMediaUploads = { ...existingMediaUploads };

  for (const key of candidateKeys) {
    const localPath = payload[key] as string;
    const cached = existingMediaUploads[key];

    if (cached && cached.localPath === localPath) {
      // Same local file as the last successful upload — reuse the
      // destination URL, no network call. Every new/replaced upload gets a
      // fresh random filename (lib/upload.ts's crypto.randomUUID()), so a
      // plain string comparison on the local path is a reliable "did this
      // image actually change" check, no content hashing needed.
      logger.info({ mediaSync: { tenantId, contentType, itemId, fieldKey: key } }, "media sync: image unchanged, reusing cached destination URL");
      nextPayload[key] = cached.destinationUrl;
      continue;
    }

    const result = await uploadImageToDestination(
      uploadUrl,
      localPathToFilesystemPath(localPath),
      headers,
      { tenantId, contentType, itemId, fieldKey: key },
      credentialRefresher
    );

    if (!result.ok) {
      logger.warn(
        { mediaSync: { tenantId, contentType, itemId, fieldKey: key } },
        `media sync: sync aborted — record will not be pushed. Reason: ${result.error}`
      );
      // Every field that uploaded successfully before this one keeps its
      // entry in nextMediaUploads — a retry only re-attempts the field that
      // actually failed.
      return { ok: false, error: `Image upload failed for field "${key}": ${result.error}`, mediaUploads: nextMediaUploads };
    }

    nextPayload[key] = result.url;
    nextMediaUploads[key] = { localPath, destinationUrl: result.url };
  }

  logger.info({ mediaSync: { tenantId, contentType, itemId, fields: candidateKeys } }, "media sync: payload updated, sync complete");
  return { ok: true, payload: nextPayload, mediaUploads: nextMediaUploads };
}
