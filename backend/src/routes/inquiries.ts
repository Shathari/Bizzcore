import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { encryptField, maskPhone, hashForLookup, normalizePhone } from "../lib/piiCrypto";

// Tenant-facing triage for Booking Requests / Inquiries — the dashboard
// counterpart to the public submission endpoint (routes/publicInquiries.ts).
// Every row an external site posts there lands here for staff to work.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const SOURCES = ["WEBSITE", "WHATSAPP", "INSTAGRAM"] as const;
const STATUSES = ["open", "followed_up", "closed"] as const;

const CUSTOMER_SELECT = { id: true, name: true, phoneMasked: true } as const;

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  source: z.enum(SOURCES).optional(),
  search: z.string().trim().optional(),
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const { status, source, search } = parsed.success ? parsed.data : {};

  const inquiries = await prisma.inquiry.findMany({
    where: {
      tenantId: req.tenantId, // tenant-scoped
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    },
    include: { customer: { select: CUSTOMER_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  // Case-insensitive substring search done in application code, same
  // reasoning as routes/customers.ts's list search: Prisma's `mode:
  // "insensitive"` only works on Postgres/MongoDB and throws at runtime
  // against the SQLite schema the test suite runs on.
  const needle = search?.toLowerCase();
  const filtered = needle
    ? inquiries.filter(
        (i) =>
          i.message.toLowerCase().includes(needle) ||
          (i.contactName?.toLowerCase().includes(needle) ?? false) ||
          (i.contactPhone?.toLowerCase().includes(needle) ?? false) ||
          (i.contactEmail?.toLowerCase().includes(needle) ?? false) ||
          (i.customer?.name.toLowerCase().includes(needle) ?? false)
      )
    : inquiries;

  res.json(filtered);
});

router.get("/:id", async (req, res) => {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
    include: { customer: { select: CUSTOMER_SELECT } },
  });
  if (!inquiry) {
    // Same 404 whether the id doesn't exist at all or belongs to another
    // tenant — cross-tenant records must never be distinguishable from
    // nonexistent ones.
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(inquiry);
});

const updateStatusSchema = z.object({ status: z.enum(STATUSES) });

router.patch("/:id/status", async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    return;
  }

  const existing = await prisma.inquiry.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const inquiry = await prisma.inquiry.update({
    where: { id: existing.id }, // tenant-scoped (existence already verified above)
    data: { status: parsed.data.status },
    include: { customer: { select: CUSTOMER_SELECT } },
  });
  res.json(inquiry);
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.inquiry.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.inquiry.delete({ where: { id: existing.id } }); // tenant-scoped (existence already verified above)
  res.status(204).send();
});

// Promotes a booking request into a real Customer record once staff act on
// it — the natural next step in the workflow, and what moves the contact's
// PII from this router's plaintext contact* fields (see schema.prisma's
// Inquiry comment) into the encrypted, access-logged Customer regime.
// Requires a phone on file, same as the manual Add Customer form
// (routes/customers.ts) — an inquiry with no phone can't become one this way.
router.post("/:id/convert-to-customer", async (req, res) => {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!inquiry) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (inquiry.customerId) {
    res.status(400).json({ error: "Already linked to a customer" });
    return;
  }
  if (!inquiry.contactPhone) {
    res.status(400).json({ error: "This inquiry has no phone number on file — add one before converting." });
    return;
  }

  const customer = await prisma.customer.create({
    data: {
      tenantId: req.tenantId!, // tenant-scoped
      name: inquiry.contactName || "New Customer",
      phone: encryptField(inquiry.contactPhone),
      phoneMasked: maskPhone(inquiry.contactPhone),
      phoneHash: hashForLookup(normalizePhone(inquiry.contactPhone)),
      email: inquiry.contactEmail || null,
      segment: "Regular",
      notes: `From booking request: ${inquiry.message}`.slice(0, 1000),
    },
  });

  const updated = await prisma.inquiry.update({
    where: { id: inquiry.id },
    data: { customerId: customer.id, status: inquiry.status === "open" ? "followed_up" : inquiry.status },
    include: { customer: { select: CUSTOMER_SELECT } },
  });

  res.status(201).json(updated);
});

export default router;
