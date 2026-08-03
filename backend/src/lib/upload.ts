import multer from "multer";
import path from "path";
import crypto from "crypto";
import type { RequestHandler } from "express";
import { uploadObject, deleteObject, deleteObjectsByPrefix, keyFromPublicUrl } from "./objectStorage";
import { logger } from "./logger";

// Every tenant upload lives at "{tenantId}/{subfolder}/{uuid}{ext}" in
// object storage (see lib/objectStorage.ts) — same namespacing convention
// the old local-disk layout used, just no longer tied to this process's
// own (ephemeral, per-instance) filesystem. A file uploaded here survives
// a Render restart/redeploy, unlike the local disk it used to live on.

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALLOWED_MIME_PATTERN = /^image\/(jpeg|png|webp|gif)$/;
const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Every upload route now buffers the file in memory (multer) and hands the
// buffer to saveBufferForTenant below, which does the actual (network)
// write to object storage — there's no longer a meaningful distinction
// between "the tenant is known at multer-parse time" and "known only
// after" (the old createUploader vs createMemoryUploader split), since
// nothing here touches the filesystem synchronously during parsing either
// way. One factory for every upload route.
export function createMemoryUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_PATTERN.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only JPEG, PNG, WebP, or GIF images are supported"));
      }
    },
  });
}

export async function saveBufferForTenant(tenantId: string, subfolder: string, originalName: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : "";
  const key = `${tenantId}/${subfolder}/${crypto.randomUUID()}${safeExt}`;
  const contentType = MIME_BY_EXTENSION[safeExt] ?? "application/octet-stream";
  return uploadObject(key, buffer, contentType);
}

// Deletes an uploaded file given the public URL saveBufferForTenant
// returned. Best-effort (never blocks the caller's API response on an
// object-storage issue) — fire-and-forget, but the rejection is caught
// and logged right here rather than left to become an unhandled
// rejection, which would now trip the process-level safety net in
// index.ts and take the whole server down over a single failed cleanup.
// Silently a no-op for a URL that isn't one of ours (e.g. a legacy local
// /uploads/... path from before this migration, or an external URL) —
// nothing to delete from object storage either way.
export function deleteUploadedFile(publicUrl: string): void {
  const key = keyFromPublicUrl(publicUrl);
  if (!key) return;
  deleteObject(key).catch((err) => {
    logger.warn({ err, key }, "upload: best-effort delete failed");
  });
}

// Permanent tenant deletion's object-storage equivalent of the old
// fs.rm(UPLOADS_ROOT/tenantId, {recursive: true}) — every key this module
// writes is namespaced "{tenantId}/...", so a prefix delete removes
// everything this tenant ever uploaded.
export async function deleteAllTenantUploads(tenantId: string): Promise<void> {
  await deleteObjectsByPrefix(`${tenantId}/`);
}

// multer's middleware calls next(err) on error rather than throwing, so a
// rejected file type or oversized upload would otherwise fall through to
// Express's default HTML error page. This wraps it to return clean JSON.
export function handleUpload(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : "File upload failed";
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  };
}
