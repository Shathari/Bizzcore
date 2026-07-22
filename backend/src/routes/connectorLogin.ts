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
// tenant's OWN connected website (see lib/connectorLogin.ts) — one login
// per site (DataSource), shared by every feature on it, set up once here
// and kept fresh automatically (on a 401) or via the manual refresh button
// below. Tenant-scoped (authorize("ADMIN") + resolveTenant), same as the
// rest of connector configuration (routes/connectorConfig.ts) — this flow
// is specifically something the tenant Admin operates themselves (their
// own site's login, their own password).
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

// Lists this tenant's connected websites (DataSources) — one row per site,
// not per feature, so the Settings UI can render "Log in with admin
// credentials" once per site instead of once per feature (the redundant,
// mistake-prone shape this replaced: two features on the identical site
// each needing their own separately-typed, separately-wrong login URL).
// Registered before "/:contentType/status" so this literal path isn't
// swallowed by that param route.
router.get("/data-sources", async (req, res) => {
  const dataSources = await prisma.dataSource.findMany({
    where: { tenantId: req.tenantId! }, // tenant-scoped
    include: { websiteIntegrations: { where: { active: true }, include: { feature: true } } },
  });
  res.json(
    dataSources
      .filter((ds) => ds.websiteIntegrations.length > 0)
      .map((ds) => ({
        id: ds.id,
        origin: ds.origin,
        loginConfigured: !!ds.loginUrl,
        credentialStatus: ds.credentialStatus,
        tokenExpiresAt: ds.tokenExpiresAt,
        // Any one of these feature keys can be used as the :contentType
        // for the write actions below — they all resolve to this same
        // DataSource, so which one is just a routing detail.
        features: ds.websiteIntegrations.map((wi) => ({
          key: wi.feature.key,
          label: wi.feature.label,
          usingLogin: wi.authType === "login",
        })),
      }))
  );
});

// Status only — never returns the password/token itself, just enough for
// the Settings UI to render current state (configured? healthy? when does
// the tenant last know it was refreshed?). Reads through to the feature's
// shared DataSource, since that's where login state actually lives.
router.get("/:contentType/status", async (req, res) => {
  const feature = await getFeatureByKey(req.tenantId!, req.params.contentType);
  if (!feature) {
    res.status(404).json({ error: "Unknown content type" });
    return;
  }
  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId: req.tenantId!, featureId: feature.id } }, // tenant-scoped
    select: { authType: true, dataSource: { select: { loginUrl: true, credentialStatus: true, tokenExpiresAt: true } } },
  });
  if (!integration) {
    res.status(404).json({ error: "Set up this connector's base URL first." });
    return;
  }
  const loginConfigured = integration.authType === "login" && !!integration.dataSource?.loginUrl;
  res.json({
    authType: integration.authType,
    loginConfigured,
    loginUrl: loginConfigured ? integration.dataSource!.loginUrl : null,
    credentialStatus: loginConfigured ? integration.dataSource!.credentialStatus : "OK",
    tokenExpiresAt: loginConfigured ? integration.dataSource!.tokenExpiresAt : null,
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
