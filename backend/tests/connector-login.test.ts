import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, configureIntegration, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt, decrypt } from "../src/lib/crypto";

// "Log in with admin credentials" — the tenant's own external site's login
// endpoint, stored email/password (encrypted), and the resulting access
// token, refreshed manually or automatically on a 401. See
// lib/connectorLogin.ts.
describe("connector login-based credentials", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("save (initial setup)", () => {
    it("logs in immediately on save, stores the token, and never returns the password in the response", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ accessToken: "tok-abc123", expiresIn: 900 }),
      } as Response);

      const res = await request(app)
        .put("/api/connector-login/PRODUCTS")
        .set("Cookie", cookie)
        .send({ loginUrl: "https://example.com/api/auth/login", email: "admin@example.com", password: "correct-horse" });

      expect(res.status).toBe(200);
      expect(res.body.credentialStatus).toBe("OK");
      expect(JSON.stringify(res.body)).not.toContain("correct-horse");
      expect(JSON.stringify(res.body)).not.toContain("tok-abc123");

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.authType).toBe("login");
      expect(integration.credentialStatus).toBe("OK");
      expect(integration.loginUrl).toBe("https://example.com/api/auth/login");
      expect(decrypt(integration.loginEmailEncrypted!)).toBe("admin@example.com");
      expect(decrypt(integration.loginPasswordEncrypted!)).toBe("correct-horse");
      expect(decrypt(integration.accessTokenEncrypted!)).toBe("tok-abc123");
      expect(integration.tokenExpiresAt).not.toBeNull();

      const logs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, action: "CREDENTIAL_LOGIN" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].outcome).toBe("success");
      expect(logs[0].details).not.toContain("correct-horse");
    });

    it("saves the credentials even when the immediate login fails, marking CredentialsExpired instead of blocking the save entirely", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "Invalid credentials" }),
      } as Response);

      const res = await request(app)
        .put("/api/connector-login/PRODUCTS")
        .set("Cookie", cookie)
        .send({ loginUrl: "https://example.com/api/auth/login", email: "admin@example.com", password: "wrong-password" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/couldn't sign in/i);

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.credentialStatus).toBe("CredentialsExpired");
      // Still persisted, so a later manual refresh doesn't need re-entry.
      expect(decrypt(integration.loginPasswordEncrypted!)).toBe("wrong-password");

      const logs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, action: "CREDENTIAL_LOGIN" } });
      expect(logs[0].outcome).toBe("failure");
      expect(logs[0].details).not.toContain("wrong-password");
    });

    it("rejects an http:// login URL", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

      const res = await request(app)
        .put("/api/connector-login/PRODUCTS")
        .set("Cookie", cookie)
        .send({ loginUrl: "http://example.com/api/auth/login", email: "admin@example.com", password: "x" });
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows http:// for localhost specifically — the dev/test carve-out for mockExternalSite.ts", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: "tok" }) } as Response);
      const res = await request(app)
        .put("/api/connector-login/PRODUCTS")
        .set("Cookie", cookie)
        .send({ loginUrl: "http://localhost:4000/api/mock-external-site/login", email: "demo@example.com", password: "demo-password" });
      expect(res.status).toBe(200);
    });
  });

  describe("manual refresh", () => {
    async function setupLoginIntegration(tenantId: string) {
      await configureIntegration(tenantId, "PRODUCTS", "https://example.com/api/products");
      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: "PRODUCTS" } } });
      await prisma.websiteIntegration.update({
        where: { tenantId_featureId: { tenantId, featureId: feature.id } },
        data: {
          authType: "login",
          loginUrl: "https://example.com/api/auth/login",
          loginEmailEncrypted: encrypt("admin@example.com"),
          loginPasswordEncrypted: encrypt("correct-horse"),
          accessTokenEncrypted: encrypt("stale-token"),
          credentialStatus: "CredentialsExpired",
        },
      });
    }

    it("re-logs in and clears CredentialsExpired on success", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await setupLoginIntegration(tenant.id);

      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: "fresh-token" }) } as Response);

      const res = await request(app).post("/api/connector-login/PRODUCTS/refresh").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.credentialStatus).toBe("OK");

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.credentialStatus).toBe("OK");
      expect(decrypt(integration.accessTokenEncrypted!)).toBe("fresh-token");
    });

    it("stays CredentialsExpired when the stored password is wrong", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await setupLoginIntegration(tenant.id);

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ message: "Invalid credentials" }) } as Response);

      const res = await request(app).post("/api/connector-login/PRODUCTS/refresh").set("Cookie", cookie);
      expect(res.status).toBe(502);

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.credentialStatus).toBe("CredentialsExpired");
    });

    it("rate-limits repeated login attempts against the external site", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      await setupLoginIntegration(tenant.id);
      fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ message: "Invalid credentials" }) } as Response);

      for (let i = 0; i < 5; i++) {
        await request(app).post("/api/connector-login/PRODUCTS/refresh").set("Cookie", cookie);
      }
      const sixth = await request(app).post("/api/connector-login/PRODUCTS/refresh").set("Cookie", cookie);
      expect(sixth.status).toBe(429);
      // The 6th call never actually reached the external site.
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe("automatic re-login on a 401 during a real write-back/import call", () => {
    async function setupLoginIntegration(tenantId: string, password = "correct-horse") {
      await configureIntegration(tenantId, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: "BLOGS" } } });
      await prisma.websiteIntegration.update({
        where: { tenantId_featureId: { tenantId, featureId: feature.id } },
        data: {
          authType: "login",
          loginUrl: "https://example.com/api/auth/login",
          loginEmailEncrypted: encrypt("admin@example.com"),
          loginPasswordEncrypted: encrypt(password),
          accessTokenEncrypted: encrypt("stale-token"),
          credentialStatus: "OK",
        },
      });
    }

    it("silently refreshes and retries once when the stored password is still correct", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);
      await setupLoginIntegration(tenant.id);

      // 1: the create attempt with the stale token -> 401
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ message: "Invalid or expired access token." }) } as Response);
      // 2: the automatic re-login -> fresh token
      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: "fresh-token" }) } as Response);
      // 3: the retried create, now with the fresh token -> succeeds
      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

      const res = await request(app).post("/api/website-content/BLOGS").set("Cookie", cookie).send({ title: "Post", content: "Body" });

      expect(res.status).toBe(201);
      expect(res.body.syncStatus).toBe("synced");
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // The retried request used the NEW token, not the stale one.
      const [, retryInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
      expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer fresh-token");

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.credentialStatus).toBe("OK");
      expect(decrypt(integration.accessTokenEncrypted!)).toBe("fresh-token");

      const loginLogs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, action: "CREDENTIAL_LOGIN" } });
      expect(loginLogs).toHaveLength(1);
      expect(loginLogs[0].outcome).toBe("success");
      expect(loginLogs[0].details).toContain("automatic_401");
    });

    it("falls through to a clean CredentialsExpired state when the stored password is now wrong, without retrying forever", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);
      await setupLoginIntegration(tenant.id, "now-wrong-password");

      // 1: the create attempt -> 401
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ message: "Invalid or expired access token." }) } as Response);
      // 2: the automatic re-login attempt -> also fails (password really is wrong now)
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ message: "Invalid credentials" }) } as Response);

      const res = await request(app).post("/api/website-content/BLOGS").set("Cookie", cookie).send({ title: "Post", content: "Body" });

      expect(res.status).toBe(502);
      // Exactly 2 calls — the original attempt + the one re-login attempt.
      // No retry of the original request, since the re-login itself failed.
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(integration.credentialStatus).toBe("CredentialsExpired");

      const loginLogs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, action: "CREDENTIAL_LOGIN" } });
      expect(loginLogs).toHaveLength(1);
      expect(loginLogs[0].outcome).toBe("failure");
    });

    it("marks CredentialsExpired on a plain bearer-token 401 too, with no retry attempted (nothing stored to re-login with)", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);
      await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE", authType: "bearer" });
      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({ where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } } });
      await prisma.websiteIntegration.update({ where: { id: integration.id }, data: { credentialStatus: "OK" } });

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ message: "expired" }) } as Response);

      const res = await request(app).post("/api/website-content/BLOGS").set("Cookie", cookie).send({ title: "Post", content: "Body" });
      expect(res.status).toBe(502);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const updated = await prisma.websiteIntegration.findUniqueOrThrow({ where: { id: integration.id } });
      expect(updated.credentialStatus).toBe("CredentialsExpired");
    });
  });

  describe("proactive refresh — before the token is even used, based on tokenExpiresAt", () => {
    async function setupExpiringIntegration(tenantId: string, tokenExpiresAt: Date) {
      await configureIntegration(tenantId, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: "BLOGS" } } });
      await prisma.websiteIntegration.update({
        where: { tenantId_featureId: { tenantId, featureId: feature.id } },
        data: {
          authType: "login",
          loginUrl: "https://example.com/api/auth/login",
          loginEmailEncrypted: encrypt("admin@example.com"),
          loginPasswordEncrypted: encrypt("correct-horse"),
          accessTokenEncrypted: encrypt("stale-token"),
          tokenExpiresAt,
          credentialStatus: "OK",
        },
      });
    }

    it("refreshes BEFORE attempting the call when tokenExpiresAt is already in the past — succeeds on the first outbound attempt, no 401 round trip", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);
      // Already expired (this is exactly the 15-minute-token scenario —
      // by the time a write happens, tokenExpiresAt is comfortably past).
      await setupExpiringIntegration(tenant.id, new Date(Date.now() - 60_000));

      // 1: the proactive re-login (BEFORE any write attempt) -> fresh token
      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ accessToken: "proactively-fresh-token", expiresIn: 900 }) } as Response);
      // 2: the create itself, using the fresh token from the start -> succeeds first try
      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

      const res = await request(app).post("/api/website-content/BLOGS").set("Cookie", cookie).send({ title: "Post", content: "Body" });

      expect(res.status).toBe(201);
      expect(res.body.syncStatus).toBe("synced");
      expect(fetchSpy).toHaveBeenCalledTimes(2); // login + one successful create — never a failing first attempt

      const [, createInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect((createInit.headers as Record<string, string>).Authorization).toBe("Bearer proactively-fresh-token");

      const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
      const integration = await prisma.websiteIntegration.findUniqueOrThrow({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
      });
      expect(decrypt(integration.accessTokenEncrypted!)).toBe("proactively-fresh-token");
      expect(integration.credentialStatus).toBe("OK");
      expect(integration.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

      const loginLogs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, action: "CREDENTIAL_LOGIN" } });
      expect(loginLogs).toHaveLength(1);
      expect(loginLogs[0].details).toContain("proactive_expiry");
    });

    it("does NOT refresh when the token is still comfortably valid", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);
      await setupExpiringIntegration(tenant.id, new Date(Date.now() + 10 * 60_000)); // 10 minutes left

      fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

      const res = await request(app).post("/api/website-content/BLOGS").set("Cookie", cookie).send({ title: "Post", content: "Body" });
      expect(res.status).toBe(201);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // no proactive login call at all

      const [, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((createInit.headers as Record<string, string>).Authorization).toBe("Bearer stale-token");
    });
  });

  describe("RBAC on the new login routes", () => {
    it("blocks Super Admin (403) and allows the tenant Admin", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");
      const tenantCookie = await loginAs(admin.email);
      const { user: superAdmin } = await createSuperAdmin();
      const superCookie = await loginAs(superAdmin.email);

      const superRes = await request(app).get("/api/connector-login/PRODUCTS/status").set("Cookie", superCookie);
      expect(superRes.status).toBe(403);

      const tenantRes = await request(app).get("/api/connector-login/PRODUCTS/status").set("Cookie", tenantCookie);
      expect(tenantRes.status).toBe(200);
    });
  });
});
