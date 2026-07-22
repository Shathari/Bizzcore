import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, configureIntegration } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { decrypt } from "../src/lib/crypto";

// Tenant-Admin-owned config surface: per-content-type external API
// endpoints for THIS tenant, scoped by auth (no tenantId in the URL — see
// routes/connectorConfig.ts). Covers RBAC (Super Admin has no write access
// at all, even to their own tenant's nonexistent connectors), tenant
// isolation, credential encryption at rest, and that raw credentials never
// round-trip back to the client.
describe("connector-config (tenant-Admin-owned)", () => {
  it("blocks SUPER_ADMIN from these routes with 403 — no tenant context", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/connector-config").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("lists all 9 content types as unconfigured for a fresh tenant", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/connector-config").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(9);
    expect(res.body.every((i: { configured: boolean }) => i.configured === false)).toBe(true);
  });

  it("rejects a bearer-auth config with no token", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "bearer" });
    expect(res.status).toBe(400);
  });

  it("rejects a plaintext http:// baseUrl — connector traffic must be TLS", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "http://example.com/api/blogs", authType: "none" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("https://");

    const stored = await prisma.websiteIntegration.findMany({ where: { tenantId: tenant.id } });
    expect(stored).toHaveLength(0); // nothing persisted from the rejected save
  });

  it("saves a config, encrypts credentials at rest, and never returns them raw", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({
        baseUrl: "https://example.com/api/blogs",
        authType: "bearer",
        credentials: { token: "SUPER-SECRET-TOKEN" },
      });
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.hasCredentials).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("SUPER-SECRET-TOKEN");

    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
    const record = await prisma.websiteIntegration.findUnique({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
    });
    expect(record).not.toBeNull();
    expect(record!.encryptedCredentials).not.toContain("SUPER-SECRET-TOKEN");
    expect(JSON.parse(decrypt(record!.encryptedCredentials!))).toEqual({ token: "SUPER-SECRET-TOKEN" });
  });

  it("saves, round-trips, and clears a custom responseMapping override", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const saved = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "none", responseMapping: { listPath: "result.catalog" } });
    expect(saved.status).toBe(200);
    expect(saved.body.responseMapping).toEqual({ listPath: "result.catalog" });

    const listed = await request(app).get("/api/connector-config").set("Cookie", cookie);
    const blogs = listed.body.find((i: { featureKey: string }) => i.featureKey === "BLOGS");
    expect(blogs.responseMapping).toEqual({ listPath: "result.catalog" });

    // Sending both paths blank clears the override rather than persisting
    // an empty object.
    const cleared = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "none", responseMapping: { listPath: "", itemPath: "" } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.responseMapping).toBeNull();
  });

  it("keeps the existing credentials when an update omits them", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/connector-config/FAQS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/faqs", authType: "bearer", credentials: { token: "original-token" } });

    await request(app)
      .put("/api/connector-config/FAQS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/faqs-v2", authType: "bearer" });

    const faqsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "FAQS" } } });
    const record = await prisma.websiteIntegration.findUnique({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: faqsFeature.id } },
    });
    expect(record!.baseUrl).toBe("https://example.com/api/faqs-v2");
    expect(JSON.parse(decrypt(record!.encryptedCredentials!))).toEqual({ token: "original-token" });
  });

  it("keeps configuration fully isolated per tenant — no tenantId param to cross into another tenant", async () => {
    const tenantA = await createTenantWithAdmin("Integration Tenant A");
    const tenantB = await createTenantWithAdmin("Integration Tenant B");
    const cookieA = await loginAs(tenantA.admin.email);
    const cookieB = await loginAs(tenantB.admin.email);

    await request(app)
      .put("/api/connector-config/CATEGORIES")
      .set("Cookie", cookieA)
      .send({ baseUrl: "https://a.example.com/categories", authType: "none" });

    const statusB = await request(app).get("/api/connector-config").set("Cookie", cookieB);
    const categoriesB = statusB.body.find((i: { featureKey: string }) => i.featureKey === "CATEGORIES");
    expect(categoriesB.configured).toBe(false);

    const statusA = await request(app).get("/api/connector-config").set("Cookie", cookieA);
    const categoriesA = statusA.body.find((i: { featureKey: string }) => i.featureKey === "CATEGORIES");
    expect(categoriesA.configured).toBe(true);
  });

  it("removes a config on delete", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/connector-config/TESTIMONIALS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/testimonials", authType: "none" });

    const deleteRes = await request(app).delete("/api/connector-config/TESTIMONIALS").set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const testimonialsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "TESTIMONIALS" } } });
    const record = await prisma.websiteIntegration.findUnique({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: testimonialsFeature.id } },
    });
    expect(record).toBeNull();
  });

  it("always forces permissionLevel to MANAGE on save, regardless of what's sent — a tenant configuring their own connector never needs to lock themselves out", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const created = await request(app)
      .put("/api/connector-config/OFFERS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/offers", authType: "none", permissionLevel: "VIEW" });
    expect(created.body.permissionLevel).toBe("MANAGE");

    const offersFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "OFFERS" } } });
    const record = await prisma.websiteIntegration.findUnique({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: offersFeature.id } },
    });
    expect(record!.permissionLevel).toBe("MANAGE");
  });

  it("audit-logs a config save and a config delete, without leaking credentials into the log", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/connector-config/BANNERS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/banners", authType: "bearer", credentials: { token: "TOP-SECRET" } });

    await request(app).delete("/api/connector-config/BANNERS").set("Cookie", cookie);

    const entries = await prisma.auditLog.findMany({ where: { targetTenantId: tenant.id }, orderBy: { createdAt: "asc" } });
    const saved = entries.find((e) => e.action === "INTEGRATION_CONFIG_SAVED");
    const deleted = entries.find((e) => e.action === "INTEGRATION_CONFIG_DELETED");
    expect(saved).toBeDefined();
    expect(deleted).toBeDefined();
    expect(saved!.details).not.toContain("TOP-SECRET");
    expect(JSON.parse(saved!.details!)).toMatchObject({ featureKey: "BANNERS", baseUrl: "https://example.com/api/banners" });
  });

  it("configures per-method endpoint overrides, encrypts their credentials, and never returns them raw", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/connector-config/PRODUCTS")
      .set("Cookie", cookie)
      .send({
        baseUrl: "https://example.com/api/products",
        authType: "none",
        endpoints: [
          { method: "GET", url: "https://example.com/api/public/products-list" },
          { method: "PATCH", url: "https://example.com/api/products/patch", authType: "bearer", credentials: { token: "ENDPOINT-SECRET" } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain("ENDPOINT-SECRET");

    const productsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
    const integration = await prisma.websiteIntegration.findUniqueOrThrow({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: productsFeature.id } },
      include: { endpoints: true },
    });
    expect(integration.endpoints).toHaveLength(2);
    const patchRow = integration.endpoints.find((e) => e.method === "PATCH");
    expect(patchRow!.encryptedCredentials).not.toContain("ENDPOINT-SECRET");
    expect(JSON.parse(decrypt(patchRow!.encryptedCredentials!))).toEqual({ token: "ENDPOINT-SECRET" });

    // Re-saving with a narrower endpoints list drops the removed override.
    const narrowed = await request(app)
      .put("/api/connector-config/PRODUCTS")
      .set("Cookie", cookie)
      .send({
        baseUrl: "https://example.com/api/products",
        authType: "none",
        endpoints: [{ method: "GET", url: "https://example.com/api/public/products-list" }],
      });
    expect(narrowed.body.endpoints).toHaveLength(1);
  });
});

// Test button (WebsiteIntegrationsPanel.tsx per-method rows) — connectivity
// check only, never persists, never invokes a real mutating call.
describe("connector-config: test connection", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("blocks SUPER_ADMIN with 403 — no tenant context", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "none" });
    expect(res.status).toBe(403);
  });

  it("for GET, performs a real fetch and returns a health signal only — never the response body", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "1" }] }) } as Response);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "none" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe(200);
    expect(typeof res.body.latencyMs).toBe("number");
    // No `preview`, `body`, or any other field carrying the actual response
    // — a health signal only, per the redaction requirement.
    expect(res.body.preview).toBeUndefined();
    expect(Object.keys(res.body).sort()).toEqual(["latencyMs", "message", "ok", "status"]);
    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledInit.method).toBe("GET");
  });

  it("for POST/PUT/PATCH/DELETE, sends a GET probe (never the real method) and omits a preview", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => "should never be sent for real" } as Response);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "DELETE", url: "https://example.com/api/products/123", authType: "none" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toContain("connectivity check only");
    expect(res.body.message).toContain("DELETE was not actually sent");
    expect(res.body.preview).toBeUndefined();
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.com/api/products/123");
    expect(calledInit.method).toBe("GET"); // never DELETE, even though that's the row being tested
  });

  it("reports a rejected-auth result distinctly for 401/403", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => "" } as Response);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "POST", url: "https://example.com/api/products", authType: "bearer", credentials: { token: "abc" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("auth was rejected");
  });

  it("times out gracefully against a hung connection instead of blocking indefinitely", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    // Simulates a real hung server: never resolves on its own, only reacts
    // to the AbortSignal fetchWithTimeout attaches — exactly how a genuine
    // stalled connection behaves under the shared REQUEST_TIMEOUT_MS
    // (overridden to 300ms in .env.test so this test stays fast).
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const startedAt = Date.now();
    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "none" });
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("Timed out");
    expect(typeof res.body.latencyMs).toBe("number");
    // Bounded, not hung — well under a real request's normal duration.
    expect(elapsed).toBeLessThan(5000);
  });

  it("falls back to already-saved credentials when none are provided in the test request", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await request(app)
      .put("/api/connector-config/PRODUCTS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/products", authType: "bearer", credentials: { token: "SAVED-TOKEN" } });

    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => "[]" } as Response);
    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((calledInit.headers as Record<string, string>).Authorization).toBe("Bearer SAVED-TOKEN");
  });

  it("reports a clear error when the auth type requires credentials that aren't saved or provided", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("No saved credentials");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a network-error result (not a 500) when the target host is unreachable", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockRejectedValue(new Error("getaddrinfo ENOTFOUND example.invalid"));

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.invalid/api/products", authType: "none" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("Unreachable");
  });
});

// "Analyze Endpoint" / "Refresh Schema" — samples the real GET response and
// returns a typed field list, persisting it so a later Refresh can diff.
describe("connector-config: discover schema", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("blocks SUPER_ADMIN with 403 — no tenant context", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });
    expect(res.status).toBe(403);
  });

  it("discovers a nested + array-of-objects response shape, matching the spec's own worked example", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              id: "prod-1",
              slug: "moonga-silk-saree",
              name: "Moonga Silk Saree",
              price: 499,
              category: { id: 1, name: "Silk" },
              images: [{ url: "https://example.com/a.jpg" }],
            },
          ],
        }),
    } as Response);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    expect(res.status).toBe(200);
    const byPath = Object.fromEntries(res.body.fields.map((f: { path: string; type: string }) => [f.path, f.type]));
    expect(byPath).toEqual({
      id: "string",
      slug: "string",
      name: "string",
      price: "number",
      "category.id": "number",
      "category.name": "string",
      "images[0].url": "string",
    });
    expect(res.body.previousFields).toBeNull();
    // Redacted preview: field names/types + a record count, never real
    // values — no field carries a `sample`/value, and recordCount reflects
    // the 1 product in the mocked response.
    expect(res.body.recordCount).toBe(1);
    expect(res.body.fields.every((f: { sample?: unknown }) => !("sample" in f))).toBe(true);

    // Persisted for the next Refresh to diff against.
    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
    const stored = await prisma.websiteIntegration.findUniqueOrThrow({ where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } } });
    expect(stored.discoveredSchema).not.toBeNull();
    expect(stored.discoveredSchema).not.toContain("moonga-silk-saree"); // the real slug value never persisted
    expect(stored.schemaDiscoveredAt).not.toBeNull();
  });

  it("Refresh Schema returns the previous snapshot alongside the new one, so the frontend can diff", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", name: "x" }] }),
    } as Response);
    await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    // Site adds two new fields since the first analysis.
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", name: "x", material: "silk", gst: 12 }] }),
    } as Response);
    const refresh = await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    expect(refresh.status).toBe(200);
    const previousPaths = refresh.body.previousFields.map((f: { path: string }) => f.path);
    const newPaths = refresh.body.fields.map((f: { path: string }) => f.path);
    expect(previousPaths.sort()).toEqual(["id", "name"]);
    expect(newPaths.sort()).toEqual(["gst", "id", "material", "name"]);
    const addedFields = newPaths.filter((p: string) => !previousPaths.includes(p));
    expect(addedFields.sort()).toEqual(["gst", "material"]);
  });

  it("reports a clear error rather than a 500 when there's nothing to sample", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) } as Response);

    const res = await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Could not find a sample record");
  });

  it("can analyze against an ad-hoc URL/auth before the integration is ever saved (test-before-save)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", name: "x" }] }),
    } as Response);

    const res = await request(app)
      .post("/api/connector-config/BLOGS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/blogs", authType: "none" });

    expect(res.status).toBe(200);
    expect(res.body.fields.map((f: { path: string }) => f.path).sort()).toEqual(["id", "name"]);

    // Not saved anywhere, since there's no integration row yet.
    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
    const stored = await prisma.websiteIntegration.findUnique({ where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } } });
    expect(stored).toBeNull();
  });

  it("appends to schema history on every Analyze/Refresh, newest first", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "1", name: "x" }] }) } as Response);
    await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "1", name: "x", material: "silk" }] }) } as Response);
    await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });

    const history = await request(app).get("/api/connector-config/PRODUCTS/schema-history").set("Cookie", cookie);

    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    // Newest first — the second (3-field) analysis is index 0.
    const firstPaths = history.body[0].fields.map((f: { path: string }) => f.path).sort();
    const secondPaths = history.body[1].fields.map((f: { path: string }) => f.path).sort();
    expect(firstPaths).toEqual(["id", "material", "name"]);
    expect(secondPaths).toEqual(["id", "name"]);
    expect(new Date(history.body[0].discoveredAt).getTime()).toBeGreaterThanOrEqual(new Date(history.body[1].discoveredAt).getTime());
  });

  it("blocks SUPER_ADMIN from schema history with 403 — no tenant context", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/connector-config/PRODUCTS/schema-history").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("returns an empty history for a feature that's never been analyzed", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    const res = await request(app).get("/api/connector-config/PRODUCTS/schema-history").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("prunes history beyond the retention cap", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    // 22 analyses, one per field count, so each snapshot is distinguishable.
    for (let i = 1; i <= 22; i++) {
      const fields: Record<string, unknown> = { id: "1" };
      for (let f = 0; f < i; f++) fields[`f${f}`] = "x";
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: [fields] }) } as Response);
      await request(app)
        .post("/api/connector-config/PRODUCTS/discover-schema")
        .set("Cookie", cookie)
        .send({ url: "https://example.com/api/products", authType: "none" });
    }

    const history = await request(app).get("/api/connector-config/PRODUCTS/schema-history").set("Cookie", cookie);
    expect(history.status).toBe(200);
    // Capped at 20, keeping only the most recent (largest field-count) ones.
    expect(history.body).toHaveLength(20);
    const maxFieldCount = Math.max(...history.body.map((s: { fields: unknown[] }) => s.fields.length));
    expect(maxFieldCount).toBe(23); // id + 22 f-fields from the 22nd (last) analysis
  });
});

// Super Admin's remaining surface: read-only connection health/status
// across tenants — see routes/superAdminWebsiteIntegrations.ts. No
// save/test/discover-schema/delete route exists here any more; connector
// configuration is entirely tenant-Admin-owned (connector-config.ts above).
describe("super-admin website-integrations (read-only)", () => {
  it("blocks a regular ADMIN from these routes with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get(`/api/super-admin/website-integrations/${tenant.id}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("lets Super Admin see a tenant-configured connector's status", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const adminCookie = await loginAs(admin.email);
    await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", adminCookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "none" });

    const { user } = await createSuperAdmin();
    const superCookie = await loginAs(user.email);
    const res = await request(app).get(`/api/super-admin/website-integrations/${tenant.id}`).set("Cookie", superCookie);
    expect(res.status).toBe(200);
    const blogs = res.body.find((i: { featureKey: string }) => i.featureKey === "BLOGS");
    expect(blogs.configured).toBe(true);
    expect(blogs.baseUrl).toBe("https://example.com/api/blogs");
  });

  it("returns 404 for an unknown tenant id", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/super-admin/website-integrations/no-such-tenant").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("has no save route left for Super Admin — configuring a connector is tenant-Admin-only now", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app)
      .put(`/api/super-admin/website-integrations/${tenant.id}/BLOGS`)
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "none" });
    expect(res.status).toBe(404);
  });

  it("has no test-connection route left for Super Admin", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app)
      .post(`/api/super-admin/website-integrations/${tenant.id}/PRODUCTS/test`)
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "none" });
    expect(res.status).toBe(404);
  });

  it("has no discover-schema route left for Super Admin", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app)
      .post(`/api/super-admin/website-integrations/${tenant.id}/PRODUCTS/discover-schema`)
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });
    expect(res.status).toBe(404);
  });

  it("has no delete route left for Super Admin", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const adminCookie = await loginAs(admin.email);
    await request(app)
      .put("/api/connector-config/TESTIMONIALS")
      .set("Cookie", adminCookie)
      .send({ baseUrl: "https://example.com/api/testimonials", authType: "none" });

    const { user } = await createSuperAdmin();
    const superCookie = await loginAs(user.email);
    const res = await request(app).delete(`/api/super-admin/website-integrations/${tenant.id}/TESTIMONIALS`).set("Cookie", superCookie);
    expect(res.status).toBe(404);

    const testimonialsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "TESTIMONIALS" } } });
    const record = await prisma.websiteIntegration.findUnique({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: testimonialsFeature.id } },
    });
    expect(record).not.toBeNull(); // untouched — the delete never happened
  });

  it("blocks a regular ADMIN from schema history with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get(`/api/super-admin/website-integrations/${tenant.id}/PRODUCTS/schema-history`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
