import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { connectorRateLimiter } from "../middleware/rateLimit";
import {
  serializeItem,
  getActiveIntegration,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  importItems,
  syncItems,
  getSyncStatusCounts,
  importFiltersSchema,
} from "../lib/websiteContentService";
import { createMemoryUploader, saveBufferForTenant, handleUpload } from "../lib/upload";

// Super-Admin-only, cross-tenant equivalent of routes/websiteContent.ts —
// Super Admin always has full create/update/delete/import access to every
// tenant's website content, for every feature (built-in or custom — see
// lib/featureCatalog.ts), regardless of that feature's per-tenant
// WebsiteIntegration.permissionLevel (that flag only affects the Business
// Admin router). Shares all CRUD/import logic
// with the Business Admin router via lib/websiteContentService.ts, this
// router just adds the cross-tenant :tenantId lookup and SUPER_ADMIN guard.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

const upload = createMemoryUploader();

async function requireTenant(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } }); // cross-tenant: super-admin
  return Boolean(tenant);
}

router.post("/:tenantId/uploads", handleUpload(upload.single("file")), async (req, res) => {
  const { tenantId } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const url = saveBufferForTenant(tenantId, "website-content", req.file.originalname, req.file.buffer);
  res.status(201).json({ url });
});

// Same enriched shape as routes/websiteContent.ts's /modules — the
// frontend's WebsiteContentManager/GenericContentTab components are shared
// between Business Admin and Super Admin callers, so both need
// label/fields/isSingleton, not just a bare key list.
router.get("/:tenantId/modules", async (req, res) => {
  const { tenantId } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const integrations = await prisma.websiteIntegration.findMany({
    where: { tenantId, active: true }, // cross-tenant: super-admin, scoped to this specific tenant
    include: { feature: true },
  });
  const counts = await getSyncStatusCounts(tenantId, integrations.map((i) => i.featureId));
  res.json(
    integrations.map((i) => ({
      key: i.feature.key,
      label: i.feature.label,
      singularLabel: i.feature.singularLabel,
      isSingleton: i.feature.isSingleton,
      fields: JSON.parse(i.feature.fields),
      canManage: i.permissionLevel === "MANAGE",
      permissionLevel: i.permissionLevel,
      lastImportedAt: i.lastImportedAt,
      lastImportRecordCount: i.lastImportRecordCount,
      itemCounts: counts.get(i.featureId),
    }))
  );
});

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/:tenantId/:contentType", async (req, res) => {
  const { tenantId, contentType } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const integration = await getActiveIntegration(tenantId, contentType);
  if (!integration) {
    res.status(404).json({ error: "This feature isn't configured for this business." });
    return;
  }
  const parsedQuery = listQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid search/pagination params" });
    return;
  }

  const result = await listItems(tenantId, integration, parsedQuery.data); // cross-tenant: super-admin, scoped to this specific tenant
  res.json(result);
});

const payloadSchema = z.record(z.unknown());

router.post("/:tenantId/:contentType", async (req, res) => {
  const { tenantId, contentType } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = await createItem(tenantId, contentType, parsed.data, req.user!.id); // cross-tenant: super-admin, scoped to this specific tenant
  if (!result.ok) {
    res.status(result.status).json(result.status === 502 ? result.item : { error: result.error });
    return;
  }
  res.status(201).json(result.item);
});

router.patch("/:tenantId/:contentType/:id", async (req, res) => {
  const { tenantId, contentType, id } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = await updateItem(tenantId, contentType, id, parsed.data, req.user!.id); // cross-tenant: super-admin, scoped to this specific tenant
  if (!result.ok) {
    if (result.status === 404) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(502).json({ error: result.error, item: result.item });
    return;
  }
  res.status(200).json(result.item);
});

router.delete("/:tenantId/:contentType/:id", async (req, res) => {
  const { tenantId, contentType, id } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const result = await deleteItem(tenantId, contentType, id, req.user!.id); // cross-tenant: super-admin, scoped to this specific tenant
  if (!result.ok) {
    if (result.status === 404) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(502).json({ error: result.error, item: result.item });
    return;
  }
  res.status(204).send();
});

router.post("/:tenantId/:contentType/import", connectorRateLimiter, async (req, res) => {
  const { tenantId, contentType } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsedFilters = importFiltersSchema.safeParse(req.body);
  if (!parsedFilters.success) {
    res.status(400).json({ error: "Invalid filters" });
    return;
  }

  const result = await importItems(tenantId, contentType, req.user!.id, parsedFilters.data); // cross-tenant: super-admin, scoped to this specific tenant
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json({ imported: result.imported, skipped: result.skipped, removed: result.removed, items: result.items });
});

router.post("/:tenantId/:contentType/sync", connectorRateLimiter, async (req, res) => {
  const { tenantId, contentType } = req.params;
  if (!(await requireTenant(tenantId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const result = await syncItems(tenantId, contentType, req.user!.id); // cross-tenant: super-admin, scoped to this specific tenant
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json({
    retried: result.retried,
    retriedFailed: result.retriedFailed,
    imported: result.import.imported,
    skipped: result.import.skipped,
    removed: result.import.removed,
    items: result.import.items,
  });
});

export default router;
