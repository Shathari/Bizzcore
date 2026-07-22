import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, configureIntegration, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encryptCredentials } from "../src/lib/websiteApiClient";

// Covers the schema/configuration-driven lookup-key addressing feature:
// PUT/PATCH/DELETE build requests using a query parameter (?key=value)
// whose value is read fresh from the item's own payload every call, when
// a lookup key is configured (WebsiteIntegration.lookupKey) — instead of
// the default baseUrl/externalId path convention. Never hardcoded to any
// specific feature or field name — the whole point is that Super Admin
// can pick ANY dashboard field, for ANY feature (built-in or custom).
describe("website integration: lookup-key query-parameter addressing", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("slug lookup: PUT and DELETE build ?slug={value}, read fresh from the item's own payload", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE", lookupKey: "slug" });

    // Create — unaffected by lookupKey, still a plain POST to the base URL.
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "internal-id-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello", slug: "first-post" });
    expect(created.status).toBe(201);
    const [createUrl, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://example.com/api/blogs");
    expect(createInit.method).toBe("POST");
    const itemId = created.body.id;

    // Update — PUT to baseUrl?slug=first-post, not baseUrl/internal-id-1.
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${itemId}`)
      .set("Cookie", cookie)
      .send({ title: "Updated post", content: "Hello again", slug: "first-post" });
    expect(updated.status).toBe(200);
    const [updateUrl, updateInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://example.com/api/blogs?slug=first-post");
    expect(updateInit.method).toBe("PUT");

    // Delete — DELETE to baseUrl?slug=first-post, read from the item's
    // stored payload (not from the update request body, which is gone by now).
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl, deleteInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe("https://example.com/api/blogs?slug=first-post");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("id lookup: lookupKey=\"id\" works generically, addressing by a payload field named id via query param (not the path convention)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE", lookupKey: "id" });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "ext-99" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A", id: "faq-42" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/FAQS/${itemId}`)
      .set("Cookie", cookie)
      .send({ question: "Q2", answer: "A2", id: "faq-42" });
    expect(updated.status).toBe(200);
    const [updateUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // Addressed by the payload's own "id" field (faq-42) via query param,
    // NOT by externalId (ext-99) via path — proves this is genuinely
    // config-driven, not a special case of the existing externalId convention.
    expect(updateUrl).toBe("https://example.com/api/faqs?id=faq-42");
  });

  it("code lookup on a CUSTOM feature (no hardcoded feature names): addresses by payload.code", async () => {
    // Created via the real Feature Catalog route (not the direct-Prisma
    // createCustomFeature helper) so the in-memory feature catalog cache
    // (lib/featureCatalog.ts) actually invalidates — bypassing it would
    // leave the cache stale for the rest of this file's tests, the exact
    // same class of bug already found and fixed in website-content.test.ts.
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const featureRes = await request(app)
      .post(`/api/super-admin/feature-catalog/${tenant.id}`)
      .set("Cookie", superCookie)
      .send({
        label: `Coupons ${Date.now()}`,
        fields: [
          { key: "code", label: "Code", type: "text", required: true },
          { key: "discountPercent", label: "Discount %", type: "number" },
        ],
      });
    expect(featureRes.status).toBe(201);
    const featureKey = featureRes.body.key;
    const featureId = featureRes.body.id;

    await configureIntegration(tenant.id, featureKey, "https://example.com/api/coupons", { permissionLevel: "MANAGE", lookupKey: "code" });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "coupon-internal-1" }) } as Response);
    const created = await request(app)
      .post(`/api/website-content/${featureKey}`)
      .set("Cookie", cookie)
      .send({ code: "SAVE20", discountPercent: 20 });
    expect(created.status).toBe(201);
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const deleted = await request(app).delete(`/api/website-content/${featureKey}/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(deleteUrl).toBe("https://example.com/api/coupons?code=SAVE20");

    // Cleanup: this custom feature is global, not tenant-scoped — delete in
    // FK-dependency order (Feature has no cascade from its WebsiteIntegration
    // reference).
    await prisma.websiteIntegration.deleteMany({ where: { featureId } });
    await prisma.feature.delete({ where: { id: featureId } });
  });

  it("legacy path-parameter APIs: no lookupKey configured keeps the exact prior baseUrl/externalId convention", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    // lookupKey deliberately omitted — this is the default, pre-existing behavior.
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello", slug: "first-post" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${itemId}`)
      .set("Cookie", cookie)
      .send({ title: "Updated", content: "Hello again", slug: "first-post" });
    expect(updated.status).toBe(200);
    const [updateUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://example.com/api/blogs/blog-ext-1");

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe("https://example.com/api/blogs/blog-ext-1");
  });

  it("an existing per-method override URL (genuine path-parameter API) still wins over lookupKey — untouched", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", {
      permissionLevel: "MANAGE",
      lookupKey: "slug",
    });
    // A Super-Admin-configured override with a literal {id} placeholder —
    // the "genuinely uses path parameters" case this feature must not break.
    await prisma.websiteIntegrationEndpoint.create({
      data: { integrationId: integration.id, method: "DELETE", url: "https://example.com/api/blogs/remove/{id}" },
    });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-9" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "Post", content: "Body", slug: "post-slug" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // Override + {id} substitution, NOT ?slug=post-slug.
    expect(deleteUrl).toBe("https://example.com/api/blogs/remove/blog-ext-9");
  });

  it("uses the field-mapped (external) name as the query parameter when the lookup key is renamed", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", {
      permissionLevel: "MANAGE",
      lookupKey: "slug",
    });
    await prisma.websiteIntegration.update({
      where: { id: integration.id },
      data: { fieldMapping: JSON.stringify({ slug: "post_slug" }) },
    });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "Post", content: "Body", slug: "renamed-slug" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${itemId}`)
      .set("Cookie", cookie)
      .send({ title: "Post v2", content: "Body v2", slug: "renamed-slug" });
    expect(updated.status).toBe(200);
    const [updateUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://example.com/api/blogs?post_slug=renamed-slug");
  });

  it("fails clearly (not silently misaddressed) when the configured lookup key has no value in the item's payload", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    // FAQS's own fields are just question/answer — no "name"/"title" field,
    // so ensureSlug's name-or-title-derived-slug fallback never applies
    // here (deliberately NOT using BLOGS+"slug": BLOGS has a "title" field,
    // and ensureSlug auto-derives a slug from it when the feature declares
    // a slug field, which would silently fill in the exact value this test
    // needs to be missing). "externalCode" is a lookup key FAQS's schema
    // doesn't declare at all, so it can never end up in the payload unless
    // explicitly sent.
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE", lookupKey: "externalCode" });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "faq-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A" });
    expect(created.status).toBe(201);
    const itemId = created.body.id;

    const updated = await request(app)
      .patch(`/api/website-content/FAQS/${itemId}`)
      .set("Cookie", cookie)
      .send({ question: "Q2", answer: "A2" });
    expect(updated.status).toBe(502);
    expect(updated.body.error).toContain('lookup key "externalCode" has no value');
    // No second network call was even attempted — the failure is caught
    // before ever making a request, not from a broken request.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const stored = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(stored!.syncStatus).toBe("failed");
    expect(stored!.lastError).toContain('lookup key "externalCode" has no value');
  });

  it("tenant Admin can configure, persist, and retrieve a lookup key through the real routes, with audit logging", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const saveRes = await request(app)
      .put("/api/connector-config/OFFERS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/offers", authType: "none", active: true, lookupKey: "code" });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.lookupKey).toBe("code");

    const statusRes = await request(app).get("/api/connector-config").set("Cookie", cookie);
    const offers = statusRes.body.find((s: { featureKey: string }) => s.featureKey === "OFFERS");
    expect(offers.lookupKey).toBe("code");

    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const auditRes = await request(app).get("/api/super-admin/audit-log").set("Cookie", superCookie);
    const entry = auditRes.body.find(
      (e: { action: string; details: { featureKey?: string } }) => e.action === "INTEGRATION_CONFIG_SAVED" && e.details?.featureKey === "OFFERS"
    );
    expect(entry.details.lookupKey).toBe("code");
    expect(entry.actorEmail).toBe(admin.email); // the tenant Admin, not Super Admin, made this change

    // Clearing it (empty string from the UI) sets it back to null.
    const clearRes = await request(app)
      .put("/api/connector-config/OFFERS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/offers", authType: "none", lookupKey: "" });
    expect(clearRes.body.lookupKey).toBeNull();
  });

  // Real-world case (found while investigating a live tenant's DELETE
  // failures): the shared baseUrl is a PUBLIC read-only path, while
  // PUT/PATCH/DELETE need a DISTINCT admin path with its own apiKey auth —
  // a static override with no way to reference a per-item value. Lookup-
  // key addressing must build off that override's own URL (and use its
  // own credentials), not silently fall back to the public baseUrl and
  // lose authentication — see resolveWriteRequest in websiteApiClient.ts.
  it("uses a per-method override's own URL (and its own credentials) as the base for lookup-key addressing, when the override has no {id}", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    // Shared/default: the public read endpoint, no auth.
    const integration = await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/public/categories", {
      permissionLevel: "MANAGE",
      lookupKey: "slug",
    });
    // Admin write endpoints: a different path entirely, with their own
    // apiKey auth — no {id} placeholder, exactly like a real tenant site
    // whose admin API only accepts a slug/code lookup, never a bare id.
    const adminCreds = encryptCredentials({ headerName: "X-Api-Key", apiKey: "admin-secret-key" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      await prisma.websiteIntegrationEndpoint.create({
        data: {
          integrationId: integration.id,
          method,
          url: "https://example.com/api/public/admin/categories",
          authType: "apiKey",
          encryptedCredentials: adminCreds,
        },
      });
    }

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "uuid-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/CATEGORIES")
      .set("Cookie", cookie)
      .send({ name: "Halka Silk", slug: "halka-silk" });
    expect(created.status).toBe(201);
    const [createUrl, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://example.com/api/public/admin/categories");
    expect((createInit.headers as Record<string, string>)["X-Api-Key"]).toBe("admin-secret-key");
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const deleted = await request(app).delete(`/api/website-content/CATEGORIES/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl, deleteInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // The admin base (NOT the public baseUrl) + ?slug=, with the
    // override's own apiKey — not the shared "none" auth.
    expect(deleteUrl).toBe("https://example.com/api/public/admin/categories?slug=halka-silk");
    expect((deleteInit.headers as Record<string, string>)["X-Api-Key"]).toBe("admin-secret-key");
  });
});
