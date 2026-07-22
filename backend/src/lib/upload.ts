import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import type { RequestHandler } from "express";

// backend/uploads/{tenantId}/{subfolder}/... — every upload is namespaced
// under the authenticated tenant's id, never a client-supplied one, since
// `destination` reads req.tenantId (set by resolveTenant, which must run
// before this middleware in the route chain).
export const UPLOADS_ROOT = path.join(__dirname, "..", "..", "uploads");

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALLOWED_MIME_PATTERN = /^image\/(jpeg|png|webp|gif)$/;

export function createUploader(subfolder: string) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const tenantId = req.tenantId;
      if (!tenantId) {
        cb(new Error("Tenant context required"), "");
        return;
      }
      const dir = path.join(UPLOADS_ROOT, tenantId, subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : "";
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  });

  return multer({
    storage,
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

export function publicUrlFor(tenantId: string, subfolder: string, filename: string): string {
  return `/uploads/${tenantId}/${subfolder}/${filename}`;
}

// For uploads where the destination tenant isn't known until after some
// other operation completes — e.g. Super Admin creating a business: the
// tenant doesn't exist yet, and Super Admin's own JWT carries no tenantId,
// so the per-request `createUploader` above (which reads req.tenantId)
// can't be used. Buffers the file in memory via multer, then this persists
// it to the now-known tenant's uploads dir afterward.
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

export function saveBufferForTenant(tenantId: string, subfolder: string, originalName: string, buffer: Buffer): string {
  const ext = path.extname(originalName).toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : "";
  const filename = `${crypto.randomUUID()}${safeExt}`;
  const dir = path.join(UPLOADS_ROOT, tenantId, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return publicUrlFor(tenantId, subfolder, filename);
}

// Deletes an uploaded file given the public URL path returned by
// publicUrlFor, ignoring errors (best-effort cleanup, never blocks the
// API response on a filesystem issue).
export function deleteUploadedFile(publicUrl: string): void {
  const relative = publicUrl.replace(/^\/uploads\//, "");
  fs.unlink(path.join(UPLOADS_ROOT, relative), () => {});
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
