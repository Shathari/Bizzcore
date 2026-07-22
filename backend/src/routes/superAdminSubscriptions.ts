import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { REQUEST_STATUSES } from "../lib/customDevelopment";

// Super-Admin-only: the add-on catalog and per-tenant add-on grants (step
// 3), and the Custom Development request queue (step 4). Plan/PlanFeature
// management itself is a separate, larger piece (step 6 of the
// subscription work). No real payment anywhere here — add-on grants are
// the same mocked-billing pattern as the rest of subscriptions (see Plan/
// Tenant.subscriptionStatus comments), and Custom Development is a
// tracked quote conversation, not a checkout at all.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

async function logAudit(actorId: string, action: string, targetTenantId: string | null, details?: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { actorId, action, targetTenantId, details: details ? JSON.stringify(details) : null },
  });
}

// The full add-on catalog, active only by default — the Grant Add-on
// dropdown shouldn't offer a retired add-on.
router.get("/addons", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const addOns = await prisma.addOn.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: "asc" },
  });
  res.json(addOns);
});

router.get("/businesses/:id/addons", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const addOns = await prisma.tenantAddOn.findMany({
    where: { tenantId: tenant.id }, // cross-tenant: super-admin, scoped to this specific tenant
    include: { addOn: true },
    orderBy: { purchasedAt: "desc" },
  });
  res.json(addOns);
});

const grantAddOnSchema = z.object({
  addOnId: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
});

router.post("/businesses/:id/addons", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = grantAddOnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const addOn = await prisma.addOn.findUnique({ where: { id: parsed.data.addOnId } });
  if (!addOn || !addOn.isActive) {
    res.status(400).json({ error: "Unknown or inactive add-on" });
    return;
  }

  const renewsAt = addOn.billingType === "Recurring" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
  const granted = await prisma.tenantAddOn.create({
    data: { tenantId: tenant.id, addOnId: addOn.id, quantity: parsed.data.quantity, status: "Active", renewsAt },
    include: { addOn: true },
  });

  await logAudit(req.user!.id, "ADDON_GRANTED", tenant.id, {
    addOnName: addOn.name,
    quantity: parsed.data.quantity,
    billingType: addOn.billingType,
  });

  res.status(201).json(granted);
});

router.patch("/businesses/:id/addons/:tenantAddOnId", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const existing = await prisma.tenantAddOn.findFirst({
    where: { id: req.params.tenantAddOnId, tenantId: tenant.id }, // cross-tenant: super-admin, scoped to this specific tenant
    include: { addOn: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const updated = await prisma.tenantAddOn.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
    include: { addOn: true },
  });
  await logAudit(req.user!.id, "ADDON_CANCELLED", tenant.id, { addOnName: existing.addOn.name });
  res.json(updated);
});

// --- Custom Development request/quote queue ----------------------------

const listQuerySchema = z.object({ status: z.enum(REQUEST_STATUSES).optional() });

// The whole queue across every tenant, newest first — a review queue, not
// a per-tenant view, so Super Admin can work through it without hopping
// between business detail pages. Optional ?status= filter for e.g. "show
// me everything still Requested".
router.get("/custom-development", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  const status = parsed.success ? parsed.data.status : undefined;
  const requests = await prisma.customDevelopmentRequest.findMany({
    where: status ? { status } : undefined, // cross-tenant: super-admin, queue view by design
    include: { tenant: { select: { id: true, businessName: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests);
});

const updateRequestSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  quotedAmount: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.patch("/custom-development/:id", async (req, res) => {
  const existing = await prisma.customDevelopmentRequest.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = updateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const updated = await prisma.customDevelopmentRequest.update({
    where: { id: existing.id },
    data: parsed.data,
    include: { tenant: { select: { id: true, businessName: true } } },
  });
  await logAudit(req.user!.id, "CUSTOM_DEV_REQUEST_UPDATED", existing.tenantId, {
    serviceType: existing.serviceType,
    from: existing.status,
    to: updated.status,
    quotedAmount: updated.quotedAmount,
  });
  res.json(updated);
});

export default router;
