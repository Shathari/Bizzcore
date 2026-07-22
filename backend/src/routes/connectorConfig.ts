import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { connectorRateLimiter } from "../middleware/rateLimit";
import {
  listIntegrationStatuses,
  saveIntegration,
  deleteIntegration,
  testEndpointConnection,
  testEndpointSchema,
  discoverAndStoreSchema,
  discoverSchemaInputSchema,
  listSchemaSnapshots,
} from "../lib/websiteIntegrationConfig";
import { getFeatureByKey } from "../lib/featureCatalog";
import { listConnectorAccessLog } from "../lib/connectorAccessLog";

// Tenant-Admin-facing: configures, per feature (built-in or custom — see
// lib/featureCatalog.ts), the external website API this tenant's own
// dashboard actions get pushed to — base URL, auth type + credentials,
// per-method endpoint overrides, field mapping, schema discovery, and
// sync/write permission. This is the tenant-scoped counterpart of
// routes/superAdminWebsiteIntegrations.ts, which now only exposes the
// read-only status/history/log views (Super Admin retains connection
// HEALTH visibility, never edit access — see that file's comment).
//
// permissionLevel is always forced to "MANAGE" on save here — there's no
// scenario where a tenant Admin configuring their OWN connector would want
// to leave themselves at VIEW-only, unlike the old Super-Admin-grants-
// access model this replaces.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

router.get("/", async (req, res) => {
  res.json(await listIntegrationStatuses(req.tenantId!)); // tenant-scoped
});

router.put("/:contentType", async (req, res) => {
  const result = await saveIntegration(
    req.tenantId!, // tenant-scoped
    req.params.contentType,
    { ...req.body, permissionLevel: "MANAGE" },
    req.user!.id
  );
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.status);
});

// Connectivity-only "Test" check — never persists anything, never invokes
// a real POST/PUT/PATCH/DELETE against this tenant's own site. See
// lib/websiteIntegrationConfig.ts's testEndpointConnection.
router.post("/:contentType/test", connectorRateLimiter, async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }

  const parsed = testEndpointSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const result = await testEndpointConnection(req.tenantId!, feature.id, parsed.data, req.user!.id); // tenant-scoped
  res.json(result);
});

// "Analyze Endpoint" / "Refresh Schema" — see
// lib/websiteIntegrationConfig.ts's discoverAndStoreSchema.
router.post("/:contentType/discover-schema", connectorRateLimiter, async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }

  const parsed = discoverSchemaInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const result = await discoverAndStoreSchema(req.tenantId!, feature.id, feature.key, parsed.data, req.user!.id); // tenant-scoped
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ fields: result.fields, recordCount: result.recordCount, previousFields: result.previousFields });
});

router.get("/:contentType/schema-history", async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }
  const snapshots = await listSchemaSnapshots(req.tenantId!, feature.id); // tenant-scoped
  res.json(snapshots);
});

router.get("/:contentType/access-log", async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }
  const entries = await listConnectorAccessLog(req.tenantId!, feature.id); // tenant-scoped
  res.json(entries);
});

router.delete("/:contentType", async (req, res) => {
  await deleteIntegration(req.tenantId!, req.params.contentType, req.user!.id); // tenant-scoped
  res.status(204).send();
});

export default router;
