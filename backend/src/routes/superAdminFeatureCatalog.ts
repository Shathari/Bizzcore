import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { listFeatures, createFeature, updateFeature, deleteFeature } from "../lib/featureCatalog";

// Super-Admin-only: CRUD on a SPECIFIC tenant's own Feature catalog
// (Products, Categories, ... and any custom feature that tenant has —
// Order Enquiries, Support Tickets, whatever). Since the tenant-scoping
// migration (prisma/scripts/tenant-scope-features.ts), Feature is no
// longer a single row shared by every tenant -- creating/editing a
// feature here only ever touches the ONE tenant named in the URL; it can
// never bleed into another tenant's copy even when both use the same
// human-facing key. GET/POST take :tenantId (need to know WHOSE catalog);
// PATCH/DELETE take only :id, since a Feature id already resolves to
// exactly one tenant's row -- no separate tenantId needed to disambiguate.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

const fieldDefSchema = z.union([
  z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.enum(["text", "textarea", "number", "date", "image", "list"]),
    required: z.boolean().optional(),
  }),
  z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.literal("select"),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1)).min(1, "At least one option is required"),
  }),
  z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.literal("checkbox"),
  }),
  z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: z.literal("repeater"),
    required: z.boolean().optional(),
    itemFields: z
      .array(
        z.object({
          key: z.string().trim().min(1),
          label: z.string().trim().min(1),
          type: z.enum(["text", "textarea"]).optional(),
        })
      )
      .min(1, "At least one sub-field is required"),
  }),
]);

// Derives a stable, immutable catalog key from a human-entered label
// (e.g. "Order Enquiries" -> "ORDER_ENQUIRIES") so Super Admin doesn't have
// to invent one — an explicit `key` in the request overrides this.
function deriveKey(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]*$/, "Key must start with a letter and contain only uppercase letters, numbers, and underscores")
    .optional(),
  label: z.string().trim().min(1, "Label is required"),
  singularLabel: z.string().trim().min(1).optional(),
  isSingleton: z.boolean().optional(),
  fields: z.array(fieldDefSchema).min(1, "At least one field is required"),
});

async function requireTenant(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } }); // cross-tenant: super-admin
  return Boolean(tenant);
}

router.get("/:tenantId", async (req, res) => {
  if (!(await requireTenant(req.params.tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await listFeatures(req.params.tenantId));
});

router.post("/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const key = parsed.data.key ?? deriveKey(parsed.data.label);
  if (!key) {
    res.status(400).json({ error: "Could not derive a valid key from this label — provide one explicitly." });
    return;
  }

  const existing = await prisma.feature.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (existing) {
    res.status(409).json({ error: `This business already has a feature with key "${key}".` });
    return;
  }

  const feature = await createFeature(tenantId, { ...parsed.data, key });
  await prisma.auditLog.create({
    data: { actorId: req.user!.id, action: "FEATURE_CREATED", targetTenantId: tenantId, details: JSON.stringify({ key: feature.key, label: feature.label }) },
  });
  res.status(201).json(feature);
});

const updateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  singularLabel: z.string().trim().min(1).nullable().optional(),
  isSingleton: z.boolean().optional(),
  fields: z.array(fieldDefSchema).min(1, "At least one field is required").optional(),
});

router.patch("/id/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const existing = await prisma.feature.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const feature = await updateFeature(req.params.id, existing.tenantId, parsed.data);
  if (!feature) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.auditLog.create({
    data: { actorId: req.user!.id, action: "FEATURE_UPDATED", targetTenantId: existing.tenantId, details: JSON.stringify({ key: feature.key }) },
  });
  res.json(feature);
});

router.delete("/id/:id", async (req, res) => {
  const existing = await prisma.feature.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const result = await deleteFeature(req.params.id);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  await prisma.auditLog.create({
    data: { actorId: req.user!.id, action: "FEATURE_DELETED", targetTenantId: existing.tenantId, details: JSON.stringify({ key: existing.key }) },
  });
  res.status(204).send();
});

export default router;
