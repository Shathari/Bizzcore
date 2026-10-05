import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicInquiryRateLimiter } from "../middleware/rateLimit";
import { phoneLookupHashes } from "../lib/piiCrypto";

// Public, unauthenticated — this is what a tenant's own external website
// (their real storefront; see lib/featureCatalog.ts's header comment on
// that split) posts to directly from a booking-request widget/form, no
// session or API key involved. Same trust model as a Formspree/Netlify-
// forms endpoint: the tenantId in the URL (copied from the snippet on the
// Booking Requests dashboard page) IS the permission to submit to it,
// nothing else — mirrors routes/mockExternalSite.ts and
// routes/publicAdminUploads.ts, which are unauthenticated for the same
// "simulating/receiving from a system outside this app" reason.
const router = Router();

const SOURCES = ["WEBSITE", "WHATSAPP", "INSTAGRAM"] as const;

const submitSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(2000),
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  contactEmail: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
  preferredAt: z.string().optional(),
  source: z.enum(SOURCES).optional(),
});

router.post("/:tenantId", publicInquiryRateLimiter, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  // Same not-found shape whether the id is malformed, unknown, or belongs to
  // a soft-deleted tenant — nothing here should tell a caller which.
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.tenantId },
    select: { id: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt) {
    res.status(404).json({ ok: false, error: "Unknown business" });
    return;
  }

  const d = parsed.data;

  let preferredAt: Date | null = null;
  if (d.preferredAt) {
    const parsedDate = new Date(d.preferredAt);
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ ok: false, error: "Invalid preferred date/time" });
      return;
    }
    preferredAt = parsedDate;
  }

  // Best-effort auto-link to an existing Customer by exact phone match, via
  // the same lookup hash customers.ts uses — read-only, never decrypts
  // anything and never creates/edits a Customer row itself.
  let customerId: string | null = null;
  if (d.contactPhone) {
    const phoneHashes = phoneLookupHashes(d.contactPhone);
    const match = await prisma.customer.findFirst({
      where: { tenantId: tenant.id, phoneHash: { in: phoneHashes } },
      select: { id: true },
    });
    customerId = match?.id ?? null;
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      tenantId: tenant.id, // tenant-scoped
      customerId,
      source: d.source ?? "WEBSITE",
      message: d.message,
      contactName: d.contactName || null,
      contactPhone: d.contactPhone || null,
      contactEmail: d.contactEmail || null,
      preferredAt,
    },
  });

  res.status(201).json({ ok: true, id: inquiry.id });
});

export default router;
