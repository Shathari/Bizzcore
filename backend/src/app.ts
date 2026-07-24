import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import authRoutes from "./routes/auth";
import passwordResetRoutes from "./routes/passwordReset";
import customerRoutes from "./routes/customers";
import superAdminRoutes from "./routes/super-admin";
import dashboardRoutes from "./routes/dashboard";
import communicationRoutes from "./routes/communication";
import socialRoutes from "./routes/social";
import aiRoutes from "./routes/ai";
import settingsRoutes from "./routes/settings";
import superAdminWebsiteIntegrationsRoutes from "./routes/superAdminWebsiteIntegrations";
import websiteContentRoutes from "./routes/websiteContent";
import superAdminWebsiteContentRoutes from "./routes/superAdminWebsiteContent";
import superAdminFeatureCatalogRoutes from "./routes/superAdminFeatureCatalog";
import mockExternalSiteRoutes from "./routes/mockExternalSite";
import publicAdminUploadsRoutes from "./routes/publicAdminUploads";
import superAdminSubscriptionsRoutes from "./routes/superAdminSubscriptions";
import superAdminPlansRoutes from "./routes/superAdminPlans";
import subscriptionRoutes from "./routes/subscription";
import billingRoutes from "./routes/billing";
import connectorLoginRoutes from "./routes/connectorLogin";
import connectorConfigRoutes from "./routes/connectorConfig";
import { UPLOADS_ROOT } from "./lib/upload";

// Builds and configures the Express app with no side effects (no
// app.listen, no cron scheduler) so it can be imported directly by tests
// via supertest without binding a real port or starting background jobs.
// index.ts is the only place that actually runs it.
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());
  if (process.env.NODE_ENV !== "test") {
    app.use(pinoHttp());
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Product images / banners — publicly readable (they're meant to appear
  // on the tenant's storefront), namespaced under each tenant's own
  // uploads dir.
  app.use("/uploads", express.static(UPLOADS_ROOT));

  app.use("/api/auth", authRoutes);
  app.use("/api/auth", passwordResetRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/super-admin", superAdminRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/communication", communicationRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/super-admin/website-integrations", superAdminWebsiteIntegrationsRoutes);
  app.use("/api/super-admin/website-content", superAdminWebsiteContentRoutes);
  app.use("/api/super-admin/feature-catalog", superAdminFeatureCatalogRoutes);
  app.use("/api/super-admin", superAdminSubscriptionsRoutes);
  app.use("/api/super-admin", superAdminPlansRoutes);
  app.use("/api/subscription", subscriptionRoutes);
  // Real-money checkout (Razorpay) — separate from the read-only
  // /api/subscription surface above; see routes/billing.ts's file comment.
  app.use("/api/billing", billingRoutes);
  // Connector configuration (base URL, auth type + credentials, endpoint
  // overrides, field mapping, schema discovery, Test Connection) is
  // tenant-Admin-owned — see routes/connectorConfig.ts. Super Admin's
  // /api/super-admin/website-integrations mount above is read-only
  // (health/status visibility only, no edit access). The "Log in with
  // admin credentials" auth mode (lib/connectorLogin.ts) is a further
  // tenant-scoped sub-flow of the same connector, for sites that only
  // offer a login rather than a long-lived pasteable token.
  app.use("/api/connector-config", connectorConfigRoutes);
  app.use("/api/connector-login", connectorLoginRoutes);
  app.use("/api/website-content", websiteContentRoutes);
  app.use("/api/mock-external-site", mockExternalSiteRoutes);
  // Local dev/demo reference implementation of the standardized media-sync
  // upload contract every tenant destination site now implements — see
  // routes/publicAdminUploads.ts and lib/mediaSync.ts's deriveUploadUrl.
  app.use("/api/public/admin", publicAdminUploadsRoutes);

  return app;
}
