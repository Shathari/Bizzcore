import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { SERVICE_TYPES, SERVICE_TYPE_INFO } from "../lib/customDevelopment";
import { listPlansWithFeatures } from "../lib/planCatalog";
import { getEffectiveEntitlementsForTenant, checkUsageLimit } from "../lib/entitlements";

// Tenant-facing subscription surface: the add-on catalog + this tenant's
// own add-ons (step 3), the Custom Development request/quote queue (step
// 4), and this tenant's own plan detail + a read-only plan comparison
// (step 6). Changing plans stays a Super Admin action (see
// routes/superAdminPlans.ts) — mirrors how add-on grants have always
// worked, no self-serve checkout since billing is mocked.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

// Metered features with a monthly UsageCounter — see lib/entitlements.ts's
// enforcement-shapes comment. Standing item caps (CMS_*) aren't included
// here since they're always current by construction (a live COUNT), not
// something that needs a separate "usage so far" readout.
const METERED_FEATURE_KEYS = ["AI_CONTENT_GENERATION", "WHATSAPP_MESSAGES", "SCHEDULED_POSTS"] as const;

router.get("/plan", async (req, res) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: req.tenantId! }, // tenant-scoped
    include: { plan: true },
  });
  const [features, usageEntries] = await Promise.all([
    getEffectiveEntitlementsForTenant(tenant.id),
    Promise.all(
      METERED_FEATURE_KEYS.map(async (featureKey) => {
        const check = await checkUsageLimit(tenant.id, featureKey, 0);
        return [
          featureKey,
          check.allowed
            ? { included: true, used: check.used, limit: check.limit }
            : { included: check.reason === "limit_reached", used: check.used, limit: check.limit },
        ] as const;
      })
    ),
  ]);

  res.json({
    plan: tenant.plan,
    subscriptionStatus: tenant.subscriptionStatus,
    currentPeriodStart: tenant.currentPeriodStart,
    currentPeriodEnd: tenant.currentPeriodEnd,
    features,
    usage: Object.fromEntries(usageEntries),
  });
});

// Read-only comparison across every active plan — no self-serve change,
// just "what would I get on a different plan" (see the file-level comment
// on why this stays Super-Admin-actioned).
router.get("/plans", async (_req, res) => {
  res.json(await listPlansWithFeatures({ activeOnly: true }));
});

// Catalog is the same for every tenant — no tenant-scoping needed, just
// active-only (a retired add-on shouldn't be offered for new purchase).
router.get("/addons", async (_req, res) => {
  const addOns = await prisma.addOn.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  res.json(addOns);
});

router.get("/my-addons", async (req, res) => {
  const addOns = await prisma.tenantAddOn.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    include: { addOn: true },
    orderBy: { purchasedAt: "desc" },
  });
  res.json(addOns);
});

// --- Custom Development request/quote queue ----------------------------
//
// Deliberately not automated billing — this pricing is inherently
// variable ("starts at ₹X", hourly), so it's a tracked request/conversation
// (see schema.prisma's CustomDevelopmentRequest), not a checkout. The price
// ranges below are reference text only, shown alongside each service type
// so the person filling out the form has a rough expectation — never
// enforced against whatever Super Admin later sets as quotedAmount.

router.get("/custom-development/service-types", (_req, res) => {
  res.json(SERVICE_TYPES.map((key) => ({ key, ...SERVICE_TYPE_INFO[key] })));
});

router.get("/custom-development", async (req, res) => {
  const requests = await prisma.customDevelopmentRequest.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
  });
  res.json(requests);
});

const createRequestSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  description: z.string().trim().min(1, "Description is required").max(4000),
});

router.post("/custom-development", async (req, res) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const created = await prisma.customDevelopmentRequest.create({
    data: {
      tenantId: req.tenantId!, // tenant-scoped
      serviceType: parsed.data.serviceType,
      description: parsed.data.description,
      requestedBy: req.user!.id,
    },
  });
  res.status(201).json(created);
});

export default router;
