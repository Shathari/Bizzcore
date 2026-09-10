// Must be the very first import in this file: it patches Express's Router
// so that a rejected Promise from any async route handler/middleware
// registered below (router.use/get/post/put/patch/delete) is forwarded to
// next(err) automatically, instead of becoming an unhandled rejection that
// crashes the whole process — this is the actual mechanism that took down
// the server during a live Prisma transaction timeout in saveIntegration.
// Has to run before any express.Router() is constructed, which happens as
// soon as the route-file imports below execute, so it must stay first.
import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import authRoutes from "./routes/auth";
import passwordResetRoutes from "./routes/passwordReset";
import customerRoutes from "./routes/customers";
import superAdminRoutes from "./routes/super-admin";
import dashboardRoutes from "./routes/dashboard";
import communicationRoutes from "./routes/communication";
import socialRoutes from "./routes/social";
import aiRoutes from "./routes/ai";
import contentResearchRoutes from "./routes/contentResearch";
import settingsRoutes from "./routes/settings";
import whatsappTemplatesRoutes from "./routes/whatsappTemplates";
import superAdminWebsiteIntegrationsRoutes from "./routes/superAdminWebsiteIntegrations";
import websiteContentRoutes from "./routes/websiteContent";
import superAdminWebsiteContentRoutes from "./routes/superAdminWebsiteContent";
import superAdminFeatureCatalogRoutes from "./routes/superAdminFeatureCatalog";
import mockExternalSiteRoutes from "./routes/mockExternalSite";
import publicAdminUploadsRoutes, { MOCK_UPLOADS_ROOT } from "./routes/publicAdminUploads";
import superAdminSubscriptionsRoutes from "./routes/superAdminSubscriptions";
import superAdminPlansRoutes from "./routes/superAdminPlans";
import subscriptionRoutes from "./routes/subscription";
import billingRoutes from "./routes/billing";
import razorpayWebhookRoutes from "./routes/webhooks/razorpay";
import whatsappWebhookRoutes from "./routes/webhooks/whatsapp";
import connectorLoginRoutes from "./routes/connectorLogin";
import connectorConfigRoutes from "./routes/connectorConfig";
import inquiryRoutes from "./routes/inquiries";
import publicInquiriesRoutes from "./routes/publicInquiries";
import customerCategoryRoutes from "./routes/customerCategories";

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
  // Mounted BEFORE express.json(): Razorpay's webhook signature is an HMAC
  // over the exact raw request bytes, so this route needs the unparsed
  // Buffer body — running it through express.json() first and
  // re-serializing would produce a different signature and always fail
  // verification. No auth middleware here by design; the verified
  // signature (checked inside the route) IS the authentication, since
  // Razorpay calls this server-to-server with no session/JWT of its own.
  app.use("/api/webhooks/razorpay", express.raw({ type: "application/json" }), razorpayWebhookRoutes);

  // Meta's WhatsApp Cloud API webhook — same reasoning as Razorpay above:
  // X-Hub-Signature-256 is an HMAC over the exact raw request bytes, so
  // this has to run before express.json() too (see webhooks/whatsapp.ts).
  // The GET verification handshake has no body, so express.raw() here is a
  // no-op for it.
  app.use("/api/webhooks/whatsapp", express.raw({ type: "application/json" }), whatsappWebhookRoutes);

  app.use(express.json());
  app.use(cookieParser());
  if (process.env.NODE_ENV !== "test") {
    app.use(pinoHttp());
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Real tenant uploads (product photos, logos, social media, etc.) are
  // served straight from their R2 public URL now (see lib/objectStorage.ts)
  // — a new upload's URL is never under this app's own origin at all. This
  // mount only still serves two things: (1) routes/publicAdminUploads.ts's
  // own local-disk mock destination site (dev/demo-only, never hit in
  // production — see its comment), and (2) any legacy /uploads/... URL
  // already stored in the DB from before this migration, best-effort (only
  // reachable if it happens to still exist on whichever instance is
  // currently running — local disk was never durable across restarts,
  // which is the exact bug this migration fixes going forward).
  app.use("/uploads", express.static(MOCK_UPLOADS_ROOT));

  app.use("/api/auth", authRoutes);
  app.use("/api/auth", passwordResetRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/customer-categories", customerCategoryRoutes);
  app.use("/api/super-admin", superAdminRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/communication", communicationRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/content-research", contentResearchRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/whatsapp/templates", whatsappTemplatesRoutes);
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
  app.use("/api/inquiries", inquiryRoutes);
  // Booking-request/inquiry submission from a tenant's own external website
  // widget — unauthenticated by design, tenantId in the URL (see
  // routes/publicInquiries.ts's file comment); not mounted under /api/mock-
  // external-site since it's a real endpoint tenants embed, not a demo stand-in.
  app.use("/api/public/inquiries", publicInquiriesRoutes);
  app.use("/api/mock-external-site", mockExternalSiteRoutes);
  // Local dev/demo reference implementation of the standardized media-sync
  // upload contract every tenant destination site now implements — see
  // routes/publicAdminUploads.ts and lib/mediaSync.ts's deriveUploadUrl.
  app.use("/api/public/admin", publicAdminUploadsRoutes);

  // Last-resort safety net — every route already handles its OWN expected
  // failures inline (res.status(4xx).json({error: "..."})), so anything
  // that reaches here is a genuinely unexpected error (a thrown exception,
  // a rejected Promise now forwarded here by express-async-errors above).
  // Always responds 500 with a fixed, generic message — the real error
  // (message + stack) goes to the log only, never to the client, since an
  // unexpected error's own message can carry internal detail (a Prisma
  // error, a file path, etc.) that was never meant to be public. Must be
  // registered after every route/middleware above — Express only recognizes
  // a 4-arg function as error-handling middleware, and only ones mounted
  // after the route that threw are considered.
  const errorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    logger.error({ err, method: req.method, url: req.originalUrl }, "unhandled request error");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  };
  app.use(errorHandler);

  return app;
}
