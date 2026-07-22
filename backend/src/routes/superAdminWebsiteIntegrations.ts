import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { listIntegrationStatuses, listSchemaSnapshots } from "../lib/websiteIntegrationConfig";
import { getFeatureByKey } from "../lib/featureCatalog";
import { listConnectorAccessLog } from "../lib/connectorAccessLog";

// Super-Admin-only, cross-tenant, READ-ONLY: connection health/status
// visibility into every tenant's connectors — the current config summary,
// schema-analysis history, and connector activity log. Super Admin can no
// longer configure, edit, test, or delete a connector here — that's
// tenant-Admin-owned now (see routes/connectorConfig.ts), including during
// onboarding. This split is deliberate: Super Admin support/ops staff can
// still see "is this tenant's connector healthy" without ever touching
// baseUrl/authType/credentials/fieldMapping.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

router.get("/:tenantId", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(await listIntegrationStatuses(tenant.id));
});

// Schema history — every past "Analyze Endpoint"/"Refresh Schema" result,
// newest first (see lib/websiteIntegrationConfig.ts's listSchemaSnapshots).
// Read-only; the current/latest snapshot is already included in the main
// GET /:tenantId status list, this is purely the "what did it look like
// before" history view.
router.get("/:tenantId/:contentType/schema-history", async (req, res) => {
  const { tenantId, contentType } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const feature = await getFeatureByKey(tenant.id, contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }

  const snapshots = await listSchemaSnapshots(tenant.id, feature.id); // cross-tenant: super-admin, scoped to this specific tenant
  res.json(snapshots);
});

// Connector audit trail — every credential save/replace, Test Connection,
// schema discovery, sync (import/export), and Confidential-field decrypt
// for this feature, newest first. See lib/connectorAccessLog.ts.
router.get("/:tenantId/:contentType/access-log", async (req, res) => {
  const { tenantId, contentType } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const feature = await getFeatureByKey(tenant.id, contentType);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }

  const entries = await listConnectorAccessLog(tenant.id, feature.id); // cross-tenant: super-admin, scoped to this specific tenant
  res.json(entries);
});

export default router;
