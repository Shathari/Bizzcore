import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, configureIntegration, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Super-Admin-facing content CRUD (routes/superAdminWebsiteContent.ts): Super
// Admin always has full access regardless of a feature's per-tenant
// WebsiteIntegration.canBusinessAdminManage delegation flag — covers RBAC,
// cross-tenant scoping, the import/sync direction, and the real-world
// { ok, data } response envelope.
describe("super-admin website-content", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("blocks a regular ADMIN from these routes with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get(`/api/super-admin/website-content/${tenant.id}/modules`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("lets Super Admin create/update/delete content for a tenant that has NOT been delegated write access", async () => {
    const { tenant } = await createTenantWithAdmin(); // canBusinessAdminManage defaults to false
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: { id: "cat-ext-1", slug: "moonga-silk" } }),
    } as Response);

    const created = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES`)
      .set("Cookie", cookie)
      .send({ name: "Moonga Silk", description: "Best refined silk" });
    expect(created.status).toBe(201);
    expect(created.body.syncStatus).toBe("synced");
    expect(created.body.externalId).toBe("cat-ext-1");
    // The real API's { id, name, description } payload requires a slug —
    // ensure it's auto-derived from `name` and actually sent.
    expect(created.body.payload.slug).toBe("moonga-silk");
    const [, createInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(createInit.body as string)).toEqual({
      name: "Moonga Silk",
      description: "Best refined silk",
      slug: "moonga-silk",
    });

    const deleteRes = await request(app)
      .delete(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/${created.body.id}`)
      .set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);
  });

  it("marks the item failed when the external API returns HTTP 200 but { ok: false } in the body", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: false, error: "slug already exists" }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES`)
      .set("Cookie", cookie)
      .send({ name: "Moonga Silk" });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");
    expect(res.body.lastError).toContain("slug already exists");
  });

  it("imports existing external items into the local dashboard mirror, keyed by external id", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: [
            { id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" },
            { id: "cat-2", slug: "kanjivaram", name: "Kanjivaram" },
          ],
        }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);

    const categoriesFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "CATEGORIES" } } });
    const stored = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: categoriesFeature.id } });
    expect(stored).toHaveLength(2);
    expect(stored.every((i) => i.syncStatus === "synced")).toBe(true);
    expect(stored.map((i) => i.externalId).sort()).toEqual(["cat-1", "cat-2"]);

    // Re-importing the same two items (renaming one) updates in place
    // rather than duplicating.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: [
            { id: "cat-1", slug: "moonga-silk", name: "Moonga Silk (renamed)" },
            { id: "cat-2", slug: "kanjivaram", name: "Kanjivaram" },
          ],
        }),
    } as Response);
    const reimport = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(2);
    expect(reimport.body.removed).toBe(0);

    const afterReimport = await prisma.websiteContentItem.findMany({
      where: { tenantId: tenant.id, featureId: categoriesFeature.id },
    });
    expect(afterReimport).toHaveLength(2);
    const cat1 = afterReimport.find((i) => i.externalId === "cat-1");
    expect(JSON.parse(cat1!.payload).name).toBe("Moonga Silk (renamed)");
  });

  // Regression coverage for every list-response shape extractList
  // (lib/websiteApiClient.ts) is documented to auto-detect, plus the
  // single-bare-object auto-wrap — each must import without a
  // Super-Admin-configured responseMapping override, i.e. purely on the
  // heuristic. Sparked by a real-world case where a tenant's site actually
  // returned an HTML auth-wall page (not JSON at all) but was initially
  // mis-diagnosed as "{ data: [...] } isn't supported" — it was already
  // supported; this locks that shape in permanently alongside its siblings.
  it.each([
    ["bare array", [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }]],
    ["{ data: [...] }", { data: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
    ["{ ok: true, data: [...] }", { ok: true, data: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
    ["{ success: true, data: [...] }", { success: true, data: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
    ["{ items: [...] }", { items: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
    ["{ results: [...] }", { results: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
    ["{ records: [...] }", { records: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }],
  ])("imports a %s response", async (_label, body) => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify(body) } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.items[0].externalId).toBe("cat-1");
  });

  it("auto-wraps a single bare resource object (not a list) into a one-item import", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.items[0].externalId).toBe("cat-1");
  });

  it("gives a diagnosable error (not just 'unexpected shape') when the response isn't JSON at all", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    // e.g. a site that redirects an unauthenticated request to an HTML
    // login page instead of returning its JSON API.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => "<!DOCTYPE html><html><head><title>Please log in</title></head></html>",
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("not valid JSON");
    expect(res.body.error).toContain("Please log in");
  });

  it("uses a configured responseMapping.listPath to import a response shape the auto-detect heuristic can't parse", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories", {
      responseMapping: { listPath: "result.catalog" },
    });

    // Nested two levels deep under keys the heuristic doesn't recognize
    // (not a bare array, not data/items/results/records) — would fail with
    // "Unexpected response shape" without the listPath override.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ result: { catalog: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] } }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.items[0].externalId).toBe("cat-1");
  });

  it("falls back to matching by slug when an item has no external id, and still skips items with neither", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: [
            { slug: "moonga-silk", name: "Moonga Silk" }, // no id — must fall back to slug
            { name: "No slug or id" }, // neither — must be skipped
          ],
        }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(1);

    const categoriesFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "CATEGORIES" } } });
    const stored = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: categoriesFeature.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].externalId).toBeNull();
    expect(JSON.parse(stored[0].payload).name).toBe("Moonga Silk");

    // Re-importing the same slug (still no id, renamed) updates the same
    // local row instead of creating a duplicate.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ ok: true, data: [{ slug: "moonga-silk", name: "Moonga Silk (renamed)" }] }),
    } as Response);
    const reimport = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(1);

    const afterReimport = await prisma.websiteContentItem.findMany({
      where: { tenantId: tenant.id, featureId: categoriesFeature.id },
    });
    expect(afterReimport).toHaveLength(1);
    expect(afterReimport[0].id).toBe(stored[0].id);
    expect(JSON.parse(afterReimport[0].payload).name).toBe("Moonga Silk (renamed)");
  });

  it("reconciles deletions on an unfiltered re-import: a synced item missing from the fetch is removed locally", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: [
            { id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" },
            { id: "cat-2", slug: "kanjivaram", name: "Kanjivaram" },
          ],
        }),
    } as Response);
    await request(app).post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`).set("Cookie", cookie);

    // cat-2 no longer exists on the external site.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: [{ id: "cat-1", slug: "moonga-silk", name: "Moonga Silk" }] }),
    } as Response);
    const reimport = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/CATEGORIES/import`)
      .set("Cookie", cookie);
    expect(reimport.status).toBe(200);
    expect(reimport.body.imported).toBe(1);
    expect(reimport.body.removed).toBe(1);

    const categoriesFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "CATEGORIES" } } });
    const stored = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: categoriesFeature.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].externalId).toBe("cat-1");
  });

  it("does NOT reconcile deletions on a filtered import (a narrowed fetch isn't the site's full current set)", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: [
            { id: "p-1", slug: "silk-saree", name: "Silk Saree", category: "silk" },
            { id: "p-2", slug: "cotton-saree", name: "Cotton Saree", category: "cotton" },
          ],
        }),
    } as Response);
    await request(app).post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`).set("Cookie", cookie);

    // A filtered import only returns silk products — p-2 must NOT be
    // treated as deleted just because this particular fetch excluded it.
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: [{ id: "p-1", slug: "silk-saree", name: "Silk Saree", category: "silk" }] }),
    } as Response);
    const reimport = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie)
      .send({ category: "silk" });
    expect(reimport.status).toBe(200);
    expect(reimport.body.removed).toBe(0);

    const productsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
    const stored = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: productsFeature.id } });
    expect(stored).toHaveLength(2);
  });

  it("one-click Sync Now retries a failed local item then re-imports, in a single call", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "TESTIMONIALS", "https://example.com/api/testimonials");

    // First create fails against the external API — item stored locally as "failed".
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" } as Response);
    const created = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/TESTIMONIALS`)
      .set("Cookie", cookie)
      .send({ customerName: "Priya", quote: "Beautiful sarees!" });
    expect(created.status).toBe(502);
    expect(created.body.syncStatus).toBe("failed");
    const itemId = created.body.id;

    // Now the external API is healthy again — Sync Now should retry the
    // failed create (in place, same id) and then import the current list.
    // Two distinct calls happen in order: the retry POST (returns the
    // created single resource) then the import GET (returns the list).
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: { id: "test-ext-1", customerName: "Priya", quote: "Beautiful sarees!" } }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({ ok: true, data: [{ id: "test-ext-1", customerName: "Priya", quote: "Beautiful sarees!" }] }),
    } as Response);
    const sync = await request(app).post(`/api/super-admin/website-content/${tenant.id}/TESTIMONIALS/sync`).set("Cookie", cookie);
    expect(sync.status).toBe(200);
    expect(sync.body.retried).toBe(1);
    expect(sync.body.retriedFailed).toBe(0);

    const testimonialsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "TESTIMONIALS" } } });
    const retriedItem = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(retriedItem).not.toBeNull();
    expect(retriedItem!.syncStatus).toBe("synced");

    const all = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: testimonialsFeature.id } });
    // The retried item keeps its id (updated in place) and the import
    // upserts it by externalId rather than creating a duplicate.
    expect(all).toHaveLength(1);
  });

  it("passes the standardized filters through as query params on the import GET", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/public/admin/products");
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, data: [] }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie)
      .send({ category: "silk", collection: "wedding-edit", featured: true, position: 1 });
    expect(res.status).toBe(200);

    const [url] = fetchSpy.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://example.com/api/public/admin/products");
    expect(parsed.searchParams.get("category")).toBe("silk");
    expect(parsed.searchParams.get("collection")).toBe("wedding-edit");
    expect(parsed.searchParams.get("featured")).toBe("true");
    expect(parsed.searchParams.get("position")).toBe("1");
    // Filters left unset don't show up as empty query params.
    expect(parsed.searchParams.has("slug")).toBe(false);
  });

  // Regression coverage for the import pagination fix: fetchWebsiteApi used
  // to trust a single GET response as the site's complete list — any real
  // catalog whose own list endpoint paginates had everything past page 1
  // silently unreachable. Now it pages through page=1, page=2, ... until a
  // page comes back with fewer than IMPORT_PAGE_SIZE(100) items.
  it("imports across multiple pages when the external API paginates its own list", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    const page1Items = Array.from({ length: 100 }, (_, i) => ({ id: `prod-${i + 1}`, name: `Product ${i + 1}` }));
    const page2Items = Array.from({ length: 30 }, (_, i) => ({ id: `prod-${i + 101}`, name: `Product ${i + 101}` }));
    fetchSpy
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ok: true, data: page1Items }) } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ok: true, data: page2Items }) } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(130);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [firstUrl] = fetchSpy.mock.calls[0] as [string];
    const [secondUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(firstUrl).searchParams.get("page")).toBe("1");
    expect(new URL(secondUrl).searchParams.get("page")).toBe("2");
  });

  it("stops after 2 requests (not the full page cap) when a site ignores pagination and returns the same set every time", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    const sameItemsEveryTime = Array.from({ length: 100 }, (_, i) => ({ id: `prod-${i + 1}`, name: `Product ${i + 1}` }));
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true, data: sameItemsEveryTime }) } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    // De-duped by externalId, not 200 duplicated rows.
    expect(res.body.imported).toBe(100);
    // page 1 (100 new items, looks like it might continue) + page 2
    // (100 items, but all already seen — stop) = exactly 2 requests, not
    // the full MAX_IMPORT_PAGES(20) safety cap.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects import filters with the wrong type", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS");

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie)
      .send({ position: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown tenant id", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/super-admin/website-content/no-such-tenant/modules").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// End-to-end proof that a nested-path field mapping (the schema-discovery
// feature's whole reason for existing — mapping e.g. "category.name" out
// of a nested response) actually works through the real HTTP-mocked
// import/create routes, not just in the unit-level getByPath/setByPath
// tests (see website-field-mapping-paths.test.ts).
describe("super-admin website-content: nested field mapping (bidirectional)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("import: promotes a nested response field to a flat dashboard field via fieldMapping", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products", {
      fieldMapping: { categoryName: "category.name" },
    });

    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: [{ id: "p-1", name: "Moonga Silk Saree", category: { id: 1, name: "Silk" } }],
        }),
    } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS/import`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.items[0].payload.categoryName).toBe("Silk");
    // The raw nested object still passes through too — no data silently
    // discarded by promoting one leaf out of it.
    expect(res.body.items[0].payload.category).toEqual({ id: 1, name: "Silk" });
  });

  it("create: builds a nested outbound payload from a flat dashboard field via the same fieldMapping", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products", {
      fieldMapping: { categoryId: "category.id" },
    });

    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "new-1" }) } as Response);

    const res = await request(app)
      .post(`/api/super-admin/website-content/${tenant.id}/PRODUCTS`)
      .set("Cookie", cookie)
      .send({ name: "New Product", categoryId: 5 });
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ name: "New Product", category: { id: 5 }, slug: "new-product" });
  });
});
