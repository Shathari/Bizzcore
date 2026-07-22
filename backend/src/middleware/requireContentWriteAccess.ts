import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { getFeatureByKey } from "../lib/featureCatalog";

// A Business Admin only gets write access (create/update/delete/import) to
// a SPECIFIC feature once its WebsiteIntegration has permissionLevel
// MANAGE — see WebsiteIntegration.permissionLevel. The tenant Admin sets
// this themselves via routes/connectorConfig.ts (always forced to MANAGE
// on save — there's no scenario where they'd configure their own connector
// and want to leave themselves VIEW-only). This is per-feature, not
// tenant-wide: configuring Products doesn't grant Categories. Read (GET)
// access only needs `active` (VIEW is the default once active) — this gate
// is applied only to the write routes in routes/websiteContent.ts. Requires
// a `:contentType` (feature key) route param. Must run after resolveTenant,
// authorize("ADMIN").
export const requireContentWriteAccess: RequestHandler = async (req, res, next) => {
  const featureKey = req.params.contentType;
  const feature = await getFeatureByKey(req.tenantId!, featureKey);
  if (!feature) {
    res.status(400).json({ error: "Unknown content type" });
    return;
  }

  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId: req.tenantId!, featureId: feature.id } }, // tenant-scoped
    select: { active: true, permissionLevel: true },
  });
  if (!integration?.active || integration.permissionLevel !== "MANAGE") {
    res.status(403).json({
      error: "This feature is managed by Super Admin. Ask them to grant edit access for it.",
    });
    return;
  }
  next();
};
