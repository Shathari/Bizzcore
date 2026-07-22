import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { requireContentWriteAccess } from "../middleware/requireContentWriteAccess";
import { connectorRateLimiter } from "../middleware/rateLimit";
import { enforceCmsItemCap, enforceFeatureIncluded } from "../middleware/enforceEntitlement";
import { prisma } from "../lib/prisma";
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
import { createUploader, publicUrlFor, handleUpload } from "../lib/upload";

// Business-Admin-facing: generic CRUD over whatever features this tenant
// has configured an external integration for (via routes/connectorConfig.ts)
// — built-in or custom, no hardcoded list (see lib/featureCatalog.ts). A
// feature with no active WebsiteIntegration simply doesn't exist as far as
// this router is concerned (404) — that's what makes a module
// "automatically appear" only once configured, per spec.
//
// Read access (GET) is always available to the Business Admin. Write
// access (create/update/delete/import) additionally requires
// permissionLevel MANAGE on this specific feature's WebsiteIntegration —
// see requireContentWriteAccess (tenant Admin sets this themselves via
// connectorConfig.ts now, always MANAGE for a connector they configure).
// This router never exposes baseUrl/authType/credentials/fieldMapping for
// any feature — that's routes/connectorConfig.ts only. Super Admin's own
// full-access content-data equivalent is routes/superAdminWebsiteContent.ts,
// sharing all the same logic via lib/websiteContentService.ts.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const upload = createUploader("website-content");

// Feature-scoped (not content-type-agnostic anymore) so the write-access
// check below can be applied per feature, same as create/update/delete.
router.post("/:contentType/uploads", requireContentWriteAccess, handleUpload(upload.single("file")), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.status(201).json({ url: publicUrlFor(req.tenantId!, "website-content", req.file.filename) });
});

// Active features for this tenant, with everything the dashboard needs to
// render them: label/fields/isSingleton (dynamic, from the Feature
// catalog — never hardcoded) and whether THIS Business Admin can write to
// each one. No baseUrl/authType/credentials ever included.
router.get("/modules", async (req, res) => {
  const integrations = await prisma.websiteIntegration.findMany({
    where: { tenantId: req.tenantId!, active: true }, // tenant-scoped
    include: { feature: true },
  });
  const counts = await getSyncStatusCounts(req.tenantId!, integrations.map((i) => i.featureId));
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

router.get("/:contentType", async (req, res) => {
  const { contentType } = req.params;
  const integration = await getActiveIntegration(req.tenantId!, contentType);
  if (!integration) {
    res.status(404).json({ error: "This feature isn't enabled for your business." });
    return;
  }
  const parsedQuery = listQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid search/pagination params" });
    return;
  }

  const result = await listItems(req.tenantId!, integration, parsedQuery.data); // tenant-scoped
  res.json(result);
});

const payloadSchema = z.record(z.unknown());

router.post("/:contentType", requireContentWriteAccess, enforceCmsItemCap, async (req, res) => {
  const { contentType } = req.params;
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = await createItem(req.tenantId!, contentType, parsed.data, req.user!.id); // tenant-scoped
  if (!result.ok) {
    res.status(result.status).json(result.status === 502 ? result.item : { error: result.error });
    return;
  }
  res.status(201).json(result.item);
});

router.patch("/:contentType/:id", requireContentWriteAccess, async (req, res) => {
  const { contentType, id } = req.params;
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = await updateItem(req.tenantId!, contentType, id, parsed.data, req.user!.id); // tenant-scoped
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

router.delete("/:contentType/:id", requireContentWriteAccess, async (req, res) => {
  const { contentType, id } = req.params;

  const result = await deleteItem(req.tenantId!, contentType, id, req.user!.id); // tenant-scoped
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

// Pulls the tenant's existing website data (from their own external API)
// into the dashboard — the counterpart to the push direction above.
router.post("/:contentType/import", requireContentWriteAccess, enforceFeatureIncluded("IMPORT_EXPORT"), connectorRateLimiter, async (req, res) => {
  const { contentType } = req.params;
  const parsedFilters = importFiltersSchema.safeParse(req.body);
  if (!parsedFilters.success) {
    res.status(400).json({ error: "Invalid filters" });
    return;
  }

  const result = await importItems(req.tenantId!, contentType, req.user!.id, parsedFilters.data); // tenant-scoped
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json({ imported: result.imported, skipped: result.skipped, removed: result.removed, items: result.items });
});

// One-click "Sync Now" — retries any locally pending/failed items, then
// re-imports from the external site (see lib/websiteContentService.ts's
// syncItems). Distinct from /import: import only pulls, sync also pushes
// first.
router.post("/:contentType/sync", requireContentWriteAccess, enforceFeatureIncluded("IMPORT_EXPORT"), connectorRateLimiter, async (req, res) => {
  const { contentType } = req.params;

  const result = await syncItems(req.tenantId!, contentType, req.user!.id); // tenant-scoped
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
