import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { listPlansWithFeatures, getPlanWithFeatures } from "../lib/planCatalog";
import { getEffectiveEntitlementsForTenant } from "../lib/entitlements";

// Super-Admin-only: the two gaps flagged (in superAdminSubscriptions.ts and
// subscription.ts's own comments) as "a separate, larger piece" — editing
// what a Plan actually includes, and assigning/overriding what a specific
// tenant gets. Before this file, both were DB-only: a tenant's planId and
// every TenantFeatureOverride row could only ever be set by hand.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

async function logAudit(actorId: string, action: string, targetTenantId: string | null, details?: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { actorId, action, targetTenantId, details: details ? JSON.stringify(details) : null },
  });
}

// --- Plans (the 4 fixed products themselves) -----------------------------

router.get("/plans", async (_req, res) => {
  res.json(await listPlansWithFeatures());
});

router.get("/plans/:id", async (req, res) => {
  const plan = await getPlanWithFeatures(req.params.id);
  if (!plan) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(plan);
});

const updatePlanSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priceMonthly: z.number().nonnegative().optional(),
  priceYearly: z.number().nonnegative().optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.patch("/plans/:id", async (req, res) => {
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const updated = await prisma.plan.update({ where: { id: existing.id }, data: parsed.data });
  await logAudit(req.user!.id, "PLAN_UPDATED", null, { planId: existing.id, planName: existing.name, changes: parsed.data });
  res.json(updated);
});

const updatePlanFeatureSchema = z.object({
  included: z.boolean(),
  value: z.string().trim().max(200).nullable(),
});

// Edits one cell of a plan's feature grid — this is what actually changes
// the product ("does Business Growth include Blog Generation, and at what
// value"), not a per-tenant exception (see the overrides routes below for
// that).
router.patch("/plans/:id/features/:featureKey", async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!plan) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const catalogEntry = await prisma.featureCatalog.findUnique({ where: { featureKey: req.params.featureKey } });
  if (!catalogEntry) {
    res.status(404).json({ error: "Unknown feature key" });
    return;
  }
  const parsed = updatePlanFeatureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const updated = await prisma.planFeature.upsert({
    where: { planId_featureKey: { planId: plan.id, featureKey: catalogEntry.featureKey } },
    update: { included: parsed.data.included, value: parsed.data.value },
    create: { planId: plan.id, featureKey: catalogEntry.featureKey, included: parsed.data.included, value: parsed.data.value },
  });
  await logAudit(req.user!.id, "PLAN_FEATURE_UPDATED", null, {
    planId: plan.id,
    planName: plan.name,
    featureKey: catalogEntry.featureKey,
    included: parsed.data.included,
    value: parsed.data.value,
  });
  res.json(updated);
});

// --- Per-tenant plan assignment -------------------------------------------

const assignPlanSchema = z.object({
  planId: z.string().min(1).nullable(),
  subscriptionStatus: z.enum(["Active", "PastDue", "Cancelled", "Trialing"]).optional(),
});

router.patch("/businesses/:id/plan", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = assignPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  let plan = null;
  if (parsed.data.planId) {
    plan = await prisma.plan.findUnique({ where: { id: parsed.data.planId } });
    if (!plan) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }
  }

  const now = new Date();
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      planId: parsed.data.planId,
      subscriptionStatus: parsed.data.subscriptionStatus ?? (parsed.data.planId ? "Active" : tenant.subscriptionStatus),
      // Mocked billing: assigning a plan starts a fresh monthly period
      // right now rather than talking to a real payment gateway — see
      // schema.prisma's Tenant.subscriptionStatus comment.
      currentPeriodStart: parsed.data.planId ? now : tenant.currentPeriodStart,
      currentPeriodEnd: parsed.data.planId ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : tenant.currentPeriodEnd,
    },
    include: { plan: true },
  });
  await logAudit(req.user!.id, "TENANT_PLAN_CHANGED", tenant.id, {
    fromPlanId: tenant.planId,
    toPlanId: parsed.data.planId,
    toPlanName: plan?.name ?? null,
  });
  res.json(updated);
});

// --- Per-tenant feature overrides ------------------------------------------

router.get("/businesses/:id/overrides", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [overrides, entitlements] = await Promise.all([
    prisma.tenantFeatureOverride.findMany({ where: { tenantId: tenant.id } }),
    getEffectiveEntitlementsForTenant(tenant.id),
  ]);
  const catalogByKey = new Map(entitlements.map((e) => [e.featureKey, e]));
  res.json(
    overrides.map((o) => ({
      ...o,
      category: catalogByKey.get(o.featureKey)?.category ?? null,
      displayName: catalogByKey.get(o.featureKey)?.displayName ?? o.featureKey,
      valueType: catalogByKey.get(o.featureKey)?.valueType ?? null,
      unit: catalogByKey.get(o.featureKey)?.unit ?? null,
    }))
  );
});

// The full effective grid (plan + overrides + add-ons combined) for this
// tenant — what Super Admin sees when deciding whether an override is even
// needed, same computation the tenant's own Subscription page uses.
router.get("/businesses/:id/entitlements", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await getEffectiveEntitlementsForTenant(tenant.id));
});

const upsertOverrideSchema = z.object({
  featureKey: z.string().min(1),
  included: z.boolean().nullable(), // null = "inherit the plan's setting" (tri-state, see schema.prisma)
  value: z.string().trim().max(200).nullable(),
});

router.post("/businesses/:id/overrides", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = upsertOverrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const catalogEntry = await prisma.featureCatalog.findUnique({ where: { featureKey: parsed.data.featureKey } });
  if (!catalogEntry) {
    res.status(400).json({ error: "Unknown feature key" });
    return;
  }

  const override = await prisma.tenantFeatureOverride.upsert({
    where: { tenantId_featureKey: { tenantId: tenant.id, featureKey: parsed.data.featureKey } },
    update: { included: parsed.data.included, value: parsed.data.value },
    create: { tenantId: tenant.id, featureKey: parsed.data.featureKey, included: parsed.data.included, value: parsed.data.value },
  });
  await logAudit(req.user!.id, "TENANT_OVERRIDE_SET", tenant.id, {
    featureKey: parsed.data.featureKey,
    included: parsed.data.included,
    value: parsed.data.value,
  });
  res.status(201).json(override);
});

router.delete("/businesses/:id/overrides/:featureKey", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const existing = await prisma.tenantFeatureOverride.findUnique({
    where: { tenantId_featureKey: { tenantId: tenant.id, featureKey: req.params.featureKey } },
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.tenantFeatureOverride.delete({ where: { id: existing.id } });
  await logAudit(req.user!.id, "TENANT_OVERRIDE_REMOVED", tenant.id, { featureKey: req.params.featureKey });
  res.status(204).send();
});

export default router;
