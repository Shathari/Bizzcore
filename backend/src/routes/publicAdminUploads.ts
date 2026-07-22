import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { UPLOADS_ROOT, handleUpload } from "../lib/upload";

// Same accepted types/size cap as the dashboard's own upload endpoint
// (lib/upload.ts) — a reference implementation should model the same
// constraints a real tenant site is expected to enforce, not accept
// anything.
const ALLOWED_MIME_PATTERN = /^image\/(jpeg|png|webp|gif)$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Local dev/demo stand-in for a tenant's REAL destination-site upload
// endpoint — POST /api/public/admin/uploads, multipart/form-data, field
// "image" — the exact contract every tenant's own site now implements (see
// lib/mediaSync.ts's deriveUploadUrl, which derives this same path from the
// integration's baseUrl origin). Same "reference implementation so a
// freshly-seeded integration has something real to hit" role as
// routes/mockExternalSite.ts, but mounted separately at the literal
// /api/public/admin path (not /api/mock-external-site) so that
// origin-based derivation actually resolves to a working endpoint when a
// local integration's baseUrl points at this same server. A production
// tenant site implements this endpoint for real; this route only exists
// for local dev/demo parity and is never hit in production.
const DEST_SUBFOLDER = "_mock-destination-site";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(UPLOADS_ROOT, DEST_SUBFOLDER);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_PATTERN.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are supported"));
    }
  },
});

const router = Router();

router.post("/uploads", handleUpload(upload.single("image")), (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: 'No file uploaded (expected multipart field "image")' });
    return;
  }
  const base = process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  res.status(201).json({ ok: true, url: `${base}/uploads/${DEST_SUBFOLDER}/${req.file.filename}` });
});

export default router;
