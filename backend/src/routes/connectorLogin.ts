import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { connectorRateLimiter } from "../middleware/rateLimit";
import { getFeatureByKey } from "../lib/featureCatalog";
import { saveLoginCredentials, manualRefreshToken } from "../lib/connectorLogin";

// Tenant-Admin-facing: the "Log in with admin credentials" auth mode for a
// tenant's OWN connector (see lib/connectorLogin.ts) — set up once here,
// then kept fresh automatically (on a 401) or via the manual refresh
// button below. Tenant-scoped (authorize("ADMIN") + resolveTenant), same
// as the rest of connector configuration (routes/connectorConfig.ts) —
// this flow is specifically something the tenant Admin operates themselves
// (their own site's login, their own password).
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

// Status only — never returns the password/token itself, just enough for
// the Settings UI to render current state (configured? healthy? when does
// the tenant last know it was refreshed?).
router.get("/:contentType/status", async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(404).json({ error: "Unknown content type" });
    return;
  }
  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId: req.tenantId!, featureId: feature.id } }, // tenant-scoped
    select: { authType: true, loginUrl: true, credentialStatus: true, tokenExpiresAt: true },
  });
  if (!integration) {
    res.status(404).json({ error: "Set up this connector's base URL first." });
    return;
  }
  res.json({
    authType: integration.authType,
    loginConfigured: integration.authType === "login" && !!integration.loginUrl,
    loginUrl: integration.authType === "login" ? integration.loginUrl : null,
    credentialStatus: integration.credentialStatus,
    tokenExpiresAt: integration.tokenExpiresAt,
  });
});

router.put("/:contentType", connectorRateLimiter, async (req, res) => {
  const result = await saveLoginCredentials(req.tenantId!, req.params.contentType, req.body, req.user!.id); // tenant-scoped
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ credentialStatus: "OK", tokenExpiresAt: result.tokenExpiresAt });
});

router.post("/:contentType/refresh", connectorRateLimiter, async (req, res) => {
  const result = await manualRefreshToken(req.tenantId!, req.params.contentType, req.user!.id); // tenant-scoped
  if (!result.ok) {
    res.status(result.rateLimited ? 429 : 502).json({ error: result.error });
    return;
  }
  res.json({ credentialStatus: "OK", tokenExpiresAt: result.tokenExpiresAt });
});

export default router;
