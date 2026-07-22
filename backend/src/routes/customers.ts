import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { revealRateLimiter, bulkExportRateLimiter } from "../middleware/rateLimit";
import { encryptField, decryptField, maskPhone, hashForLookup, monthDayOf, normalizePhone } from "../lib/piiCrypto";
import { logAccess, logBulkAccess, listAccessLogForCustomer, type PiiField } from "../lib/accessLog";

const router = Router();

// authorize("ADMIN") here means "tenant Admin" — Super Admin never carries
// this role/tenant combination (see lib/roles.ts), so every route below,
// including /reveal, is unreachable for Super Admin by construction, not by
// a separate check.
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const SEGMENTS = ["Regular", "VIP", "Bridal"] as const;

// Every customer read (list, detail, and the response echoed back from
// create) goes through this select + toSafeCustomer pair — phone/birthday
// ciphertext is never selected for a read response, full stop. phoneHash and
// birthdayMonthDay are selected because the route logic needs them (exact
// phone search, "does this customer have a birthday on file"), but
// toSafeCustomer strips both before the response goes out; only phoneMasked
// and the derived hasBirthday boolean actually reach the client.
const SAFE_CUSTOMER_SELECT = {
  id: true,
  name: true,
  phoneMasked: true,
  phoneHash: true,
  email: true,
  segment: true,
  birthdayMonthDay: true,
  totalSpent: true,
  lastPurchase: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSafeCustomer<T extends { birthdayMonthDay: string | null; phoneHash: string | null }>(
  row: T
): Omit<T, "birthdayMonthDay" | "phoneHash"> & { hasBirthday: boolean } {
  const { birthdayMonthDay, phoneHash, ...rest } = row;
  return { ...rest, hasBirthday: birthdayMonthDay !== null };
}

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  segment: z.enum(SEGMENTS).optional(),
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const { search, segment } = parsed.success ? parsed.data : {};

  const customers = await prisma.customer.findMany({
    where: {
      tenantId: req.tenantId, // tenant-scoped
      ...(segment ? { segment } : {}),
    },
    select: SAFE_CUSTOMER_SELECT,
    orderBy: { createdAt: "desc" },
  });

  // Case-insensitive substring search on name/email only, done in
  // application code (Prisma's `mode: "insensitive"` only works on
  // Postgres/MongoDB and throws at runtime against SQLite). Phone is no
  // longer substring-searchable — it's encrypted — but an exact match
  // (the search box holding a full phone number) still works via phoneHash,
  // without ever decrypting a row just to check if it matches.
  const needle = search?.toLowerCase();
  const phoneHashSearch = search && normalizePhone(search).length >= 6 ? hashForLookup(normalizePhone(search)) : null;
  const filtered = needle
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.email?.toLowerCase().includes(needle) ?? false) ||
          (phoneHashSearch !== null && c.phoneHash === phoneHashSearch)
      )
    : customers;

  res.json(filtered.map(toSafeCustomer));
});

// --- CSV export -------------------------------------------------------
//
// Two distinct actions, deliberately not one export with a checkbox: the
// default export never touches phone/birthday at all (nothing to log,
// nothing sensitive leaves the encrypted column); the contact-info export
// is its own endpoint, requires an explicit `{ confirm: true }` body (a
// button-triggered confirm dialog on the frontend, not a checkbox easily
// left checked by habit), JIT-decrypts, and logs once per export via
// logBulkAccess. Built entirely in memory — the CSV string is generated
// and sent directly as the response body, so no temp file ever touches
// disk in the first place, which is a stricter guarantee than "delete it
// right after" would be.
//
// Registered before GET /:id — Express would otherwise match "export" as
// the :id param and this route would never be reached.

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

router.get("/export", async (req, res) => {
  const customers = await prisma.customer.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
    select: { name: true, email: true, segment: true, totalSpent: true, lastPurchase: true, notes: true, createdAt: true },
  });

  const csv = toCsv(
    ["Name", "Email", "Segment", "Total Spent", "Last Purchase", "Notes", "Created At"],
    customers.map((c) => [
      c.name,
      c.email ?? "",
      c.segment,
      c.totalSpent,
      c.lastPurchase ? c.lastPurchase.toISOString() : "",
      c.notes ?? "",
      c.createdAt.toISOString(),
    ])
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${Date.now()}.csv"`);
  res.send(csv);
});

const exportContactSchema = z.object({ confirm: z.literal(true) });

router.post("/export/contact", bulkExportRateLimiter, async (req, res) => {
  const parsed = exportContactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "This export must be explicitly confirmed." });
    return;
  }

  const customers = await prisma.customer.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
  });

  const csv = toCsv(
    ["Name", "Phone", "Birthday", "Email", "Segment", "Total Spent", "Last Purchase", "Notes", "Created At"],
    customers.map((c) => [
      c.name,
      decryptField(c.phone),
      c.birthday ? decryptField(c.birthday) : "",
      c.email ?? "",
      c.segment,
      c.totalSpent,
      c.lastPurchase ? c.lastPurchase.toISOString() : "",
      c.notes ?? "",
      c.createdAt.toISOString(),
    ])
  );

  await logBulkAccess({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    reason: "csv_export_with_contact",
    recordCount: customers.length,
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-with-contact-${Date.now()}.csv"`);
  res.send(csv);
});

router.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
    select: SAFE_CUSTOMER_SELECT,
  });
  if (!customer) {
    // Same 404 whether the id doesn't exist at all or belongs to another
    // tenant — cross-tenant records must never be distinguishable from
    // nonexistent ones.
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(toSafeCustomer(customer));
});

// Deliberate, per-field, per-customer decrypt — the escape hatch for a
// specific job (e.g. tallying an order against a WhatsApp thread) that
// doesn't fit the automated JIT paths (broadcast send, follow-up call).
// Never available from the list/table view; the frontend only surfaces this
// from the customer detail view, and must re-mask the returned value after
// a short display window rather than leaving it visible indefinitely.
const revealFieldSchema = z.object({
  field: z.enum(["phone", "birthday"]),
});

router.post("/:id/reveal", revealRateLimiter, async (req, res) => {
  const parsed = revealFieldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "field must be \"phone\" or \"birthday\"" });
    return;
  }
  const field: PiiField = parsed.data.field;

  // Selecting both fields (rather than a dynamic `{ [field]: true }`) keeps
  // Prisma's return type concretely typed instead of collapsing to a union
  // TypeScript can't cleanly index — cheap either way, both are short strings.
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
    select: { phone: true, birthday: true },
  });
  if (!customer) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const raw = customer[field];
  if (!raw) {
    res.json({ value: null });
    return;
  }

  const value = decryptField(raw);
  await logAccess({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    customerId: req.params.id,
    field,
    reason: "manual_reveal",
  });

  res.json({ value });
});

// Read-only audit trail for this customer's PII decrypt events — the
// answer to "who looked at this, when, and why" if a leak is ever
// suspected. actorId-null rows (system/cron jobs) resolve to a "System
// (…)" label here rather than reaching the frontend as null.
router.get("/:id/access-log", async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
    select: { id: true },
  });
  if (!customer) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const entries = await listAccessLogForCustomer(req.tenantId!, req.params.id);
  res.json(entries);
});

// Home dashboard "Call" action on a priority follow-up — same JIT-decrypt +
// log shape as /reveal but phone-only, unconditional (no field param), and
// logged under its own reason so the audit trail distinguishes "staff
// called this customer from their follow-up queue" from a deliberate detail-
// view reveal. Shares the same rate limiter — it's the same risk class.
router.post("/:id/call", revealRateLimiter, async (req, res) => {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
    select: { phone: true },
  });
  if (!customer) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const phone = decryptField(customer.phone);
  await logAccess({
    tenantId: req.tenantId!,
    actorId: req.user!.id,
    customerId: req.params.id,
    field: "phone",
    reason: "follow_up_call",
  });

  res.json({ phone });
});

const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(1, "Phone is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  segment: z.enum(SEGMENTS).optional(),
  birthday: z.string().optional(),
  totalSpent: z.number().nonnegative().optional(),
  lastPurchase: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const d = parsed.data;
  const birthdayDate = d.birthday ? new Date(d.birthday) : null;

  const customer = await prisma.customer.create({
    data: {
      tenantId: req.tenantId!, // tenant-scoped
      name: d.name,
      // Encrypted immediately on submit — see lib/piiCrypto.ts. Nothing
      // downstream of this point (including the response below) ever sees
      // the plaintext again except a JIT decrypt path that logs to AccessLog.
      phone: encryptField(d.phone),
      phoneMasked: maskPhone(d.phone),
      phoneHash: hashForLookup(normalizePhone(d.phone)),
      email: d.email || null,
      segment: d.segment ?? "Regular",
      birthday: birthdayDate ? encryptField(birthdayDate.toISOString()) : null,
      birthdayMonthDay: birthdayDate ? monthDayOf(birthdayDate) : null,
      totalSpent: d.totalSpent ?? 0,
      lastPurchase: d.lastPurchase ? new Date(d.lastPurchase) : null,
      notes: d.notes || null,
    },
    select: SAFE_CUSTOMER_SELECT,
  });

  res.status(201).json(toSafeCustomer(customer));
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.customer.delete({ where: { id: existing.id } }); // tenant-scoped (existence already verified above)
  res.status(204).send();
});

// --- CSV/Excel import -------------------------------------------------
//
// Two-step flow: preview parses the uploaded file server-side (xlsx must
// run server-side per spec) and hands the full parsed data back to the
// frontend as JSON, which holds it in memory while the user builds a
// column mapping; commit applies that mapping, validates row-by-row, and
// inserts. This avoids needing any server-side session/file state between
// the two requests.
//
// The `xlsx` package has known, currently-unpatched advisories (prototype
// pollution, ReDoS) with no fix published to the npm registry. Mitigated
// here by: this route requires an authenticated tenant ADMIN (never public),
// a 5MB file size cap, a row-count cap, and disabling formula/HTML cell
// parsing (the more exploit-prone feature surface) — not by avoiding the
// package, since it's the one specified.

const MAX_IMPORT_ROWS = 2000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv, .xlsx, or .xls files are supported"));
    }
  },
});

router.post("/import/preview", (req, res) => {
  upload.single("file")(req, res, (uploadErr) => {
    if (uploadErr) {
      res.status(400).json({ error: uploadErr.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer", cellFormula: false, cellHTML: false });
    } catch {
      res.status(400).json({ error: "Could not read this file. Please check the format." });
      return;
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });

    if (rows.length === 0) {
      res.status(400).json({ error: "No rows found in this file." });
      return;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      res.status(400).json({ error: `This file has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}.` });
      return;
    }

    const headers = Object.keys(rows[0]);
    const stringRows = rows.map((row) => Object.fromEntries(headers.map((h) => [h, String(row[h] ?? "")])));

    res.json({ headers, rows: stringRows, totalRows: stringRows.length });
  });
});

const IMPORT_TARGET_FIELDS = [
  "name",
  "phone",
  "email",
  "birthday",
  "segment",
  "total_spent",
  "last_purchase",
  "notes",
] as const;
type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

const importCommitSchema = z.object({
  mapping: z.record(z.string().nullable()),
  rows: z.array(z.record(z.string())).max(MAX_IMPORT_ROWS),
});

function parseImportSegment(value: string): (typeof SEGMENTS)[number] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "vip") return "VIP";
  if (normalized === "bridal") return "Bridal";
  return "Regular";
}

function parseImportDate(value: string): Date | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseImportNumber(value: string): number {
  const n = Number(value.replace(/[,₹$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

router.post("/import/commit", async (req, res) => {
  const parsed = importCommitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid import payload" });
    return;
  }
  const { mapping, rows } = parsed.data;
  const tenantId = req.tenantId!;

  const errors: Array<{ row: number; message: string }> = [];
  const toInsert: Array<{
    tenantId: string;
    name: string;
    phone: string;
    phoneMasked: string;
    phoneHash: string;
    email: string | null;
    segment: string;
    birthday: string | null;
    birthdayMonthDay: string | null;
    totalSpent: number;
    lastPurchase: Date | null;
    notes: string | null;
  }> = [];

  rows.forEach((row, index) => {
    const get = (field: ImportTargetField): string => {
      const column = mapping[field];
      return column ? (row[column] ?? "").trim() : "";
    };

    const name = get("name");
    const phone = get("phone");
    if (!name || !phone) {
      errors.push({ row: index + 2, message: "Name and phone are required" }); // +2: header row + 1-indexed
      return;
    }

    const emailRaw = get("email");
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      errors.push({ row: index + 2, message: `Invalid email: ${emailRaw}` });
      return;
    }

    // Encrypted at the moment the row is built, the same as the Add
    // Customer form — nothing in this route ever writes plaintext phone/
    // birthday to the database, including via bulk import.
    const birthdayDate = parseImportDate(get("birthday"));

    toInsert.push({
      tenantId, // tenant-scoped
      name,
      phone: encryptField(phone),
      phoneMasked: maskPhone(phone),
      phoneHash: hashForLookup(normalizePhone(phone)),
      email: emailRaw || null,
      segment: parseImportSegment(get("segment") || "Regular"),
      birthday: birthdayDate ? encryptField(birthdayDate.toISOString()) : null,
      birthdayMonthDay: birthdayDate ? monthDayOf(birthdayDate) : null,
      totalSpent: get("total_spent") ? parseImportNumber(get("total_spent")) : 0,
      lastPurchase: parseImportDate(get("last_purchase")),
      notes: get("notes") || null,
    });
  });

  if (toInsert.length > 0) {
    await prisma.customer.createMany({ data: toInsert }); // tenant-scoped (tenantId set per row above)
  }

  res.json({ inserted: toInsert.length, errors });
});

export default router;
