import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, configureIntegration, loginAs, createSuperAdmin, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encryptCredentials } from "../src/lib/websiteApiClient";
import { decryptField } from "../src/lib/piiCrypto";

// Business-Admin-facing generic content CRUD: covers module gating (a
// feature only exists as a dashboard module once Super Admin has
// configured + activated a WebsiteIntegration for it), the external-sync
// round trip, and tenant isolation for both the config and the content
// items themselves.
describe("website-content: business admin generic modules", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 404 for a feature with no active integration (module doesn't exist yet)", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/website-content/FAQS").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("lists only active features under /modules", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS");
    const blogsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
    await prisma.websiteIntegration.create({
      data: { tenantId: tenant.id, featureId: blogsFeature.id, baseUrl: "https://example.com/api/blogs", authType: "none", active: false },
    });

    const res = await request(app).get("/api/website-content/modules").set("Cookie", cookie);
    expect(res.body.map((m: { key: string }) => m.key)).toEqual(["FAQS"]);
  });

  // Regression coverage for the local list's search/pagination — these
  // query params were already validated and applied server-side
  // (listItems in lib/websiteContentService.ts) but had never actually been
  // exercised by a test, and separately the frontend wasn't even calling
  // them until this fix (previously `.then((res) => res.items)` discarded
  // total/page/pageSize entirely, silently capping every feature's UI at
  // the first `pageSize` items with no way to see or search the rest).
  it("paginates local items and returns total/page/pageSize", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs");
    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "FAQS" } } });
    await prisma.websiteContentItem.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        tenantId: tenant.id,
        featureId: feature.id,
        payload: JSON.stringify({ question: `Question ${i + 1}`, answer: "A" }),
        syncStatus: "synced",
      })),
    });

    const page1 = await request(app).get("/api/website-content/FAQS").set("Cookie", cookie);
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(page1.body.items).toHaveLength(20);

    const page2 = await request(app).get("/api/website-content/FAQS?page=2").set("Cookie", cookie);
    expect(page2.body).toMatchObject({ total: 25, page: 2, pageSize: 20 });
    expect(page2.body.items).toHaveLength(5);

    const page1Ids = new Set(page1.body.items.map((i: { id: string }) => i.id));
    const overlap = page2.body.items.filter((i: { id: string }) => page1Ids.has(i.id));
    expect(overlap).toHaveLength(0);
  });

  it("filters local items by a substring search over the payload", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs");
    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "FAQS" } } });
    await prisma.websiteContentItem.createMany({
      data: [
        {
          tenantId: tenant.id,
          featureId: feature.id,
          payload: JSON.stringify({ question: "Do you ship internationally?", answer: "Yes" }),
          syncStatus: "synced",
        },
        {
          tenantId: tenant.id,
          featureId: feature.id,
          payload: JSON.stringify({ question: "What is your return policy?", answer: "30 days" }),
          syncStatus: "synced",
        },
      ],
    });

    const res = await request(app).get("/api/website-content/FAQS?search=international").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].payload.question).toBe("Do you ship internationally?");
  });

  it("blocks a Business Admin from writing content until Super Admin delegates it", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs");

    const create = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A" });
    expect(create.status).toBe(403);

    const importRes = await request(app).post("/api/website-content/FAQS/import").set("Cookie", cookie);
    expect(importRes.status).toBe(403);

    // Reading stays open regardless of the write-permission gate.
    const list = await request(app).get("/api/website-content/FAQS").set("Cookie", cookie);
    expect(list.status).toBe(200);
  });

  it("creates an item and pushes it to the external API, recording synced status", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "ext-1" }) } as Response);

    const res = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Do you ship internationally?", answer: "Yes" });

    expect(res.status).toBe(201);
    expect(res.body.syncStatus).toBe("synced");
    expect(res.body.payload).toEqual({ question: "Do you ship internationally?", answer: "Yes" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/faqs");
    expect(init.method).toBe("POST");
  });

  it("encrypts a Confidential field at rest, strips it from every read response, and excludes it from the outbound push", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    const marked = await request(app)
      .put("/api/connector-config/FAQS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/faqs", authType: "none", confidentialFields: ["answer"] });
    expect(marked.status).toBe(200);
    expect(marked.body.confidentialFields).toEqual(["answer"]);
    expect(marked.body.confidentialWriteEnabled).toEqual([]);

    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "ext-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Do you ship internationally?", answer: "Confidential answer text" });

    expect(created.status).toBe(201);
    expect(created.body.payload.question).toBe("Do you ship internationally?");
    expect(created.body.payload.answer).toBeUndefined(); // never in the response, not even masked

    // Encrypted at rest, not plaintext in the DB.
    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: created.body.id } });
    const storedPayload = JSON.parse(stored.payload) as Record<string, unknown>;
    expect(storedPayload.answer).not.toBe("Confidential answer text");
    expect(decryptField(storedPayload.answer as string)).toBe("Confidential answer text");

    // Stripped from the list view too (Data Manager table).
    const list = await request(app).get("/api/website-content/FAQS").set("Cookie", cookie);
    expect(list.body.items[0].payload.answer).toBeUndefined();

    // Confidential but not write-enabled — excluded from the outbound push
    // to the tenant's external site, even though permissionLevel is MANAGE.
    const [, init2] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init2.body as string);
    expect(sentBody.question).toBe("Do you ship internationally?");
    expect(sentBody.answer).toBeUndefined();
  });

  it("rejects confidentialWriteEnabled entries that aren't also confidentialFields", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });

    const res = await request(app)
      .put("/api/connector-config/FAQS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/faqs", authType: "none", confidentialWriteEnabled: ["answer"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("answer");
  });

  it("includes a field in the outbound push once confidentialWriteEnabled explicitly confirms it", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    await request(app)
      .put("/api/connector-config/FAQS")
      .set("Cookie", cookie)
      .send({
        baseUrl: "https://example.com/api/faqs",
        authType: "none",
        confidentialFields: ["answer"],
        confidentialWriteEnabled: ["answer"],
      });

    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "ext-2" }) } as Response);
    await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Do you gift wrap?", answer: "Write-back-enabled answer" });

    const [, init2] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init2.body as string);
    expect(sentBody.answer).toBe("Write-back-enabled answer");
  });

  // Regression test for the ensureSlug fix (lib/slugify.ts): it used to
  // inject a "slug" key derived from any "name"/"title" field regardless
  // of whether the feature's own schema declared one — harmless for every
  // built-in (the ones with name/title also declare slug), but a real
  // surprise for a custom feature that has a "name" field without a "slug"
  // field, silently sending an extra key the tenant's external API was
  // never told to expect. Now gated on the feature actually declaring a
  // slug field.
  it("does not inject a slug for a custom feature whose schema has no slug field", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);

    const featureRes = await request(app)
      .post(`/api/super-admin/feature-catalog/${tenant.id}`)
      .set("Cookie", superCookie)
      .send({ label: `Events ${Date.now()}`, fields: [{ key: "name", label: "Name", type: "text", required: true }] });
    expect(featureRes.status).toBe(201);
    const featureKey = featureRes.body.key;

    await configureIntegration(tenant.id, featureKey, "https://example.com/api/events", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "evt-1" }) } as Response);

    const res = await request(app)
      .post(`/api/website-content/${featureKey}`)
      .set("Cookie", cookie)
      .send({ name: "Trunk Show" });

    expect(res.status).toBe(201);
    expect(res.body.payload).toEqual({ name: "Trunk Show" });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ name: "Trunk Show" });

    // The Feature Catalog is global (shared across every tenant, not reset
    // between test files — see globalSetup.ts), so a custom feature
    // created here would otherwise permanently inflate its count for every
    // other test in the same run that asserts against it (e.g.
    // website-integrations.test.ts's "lists all 9 content types"). Clean
    // up in dependency order — Feature has no cascade delete from its
    // WebsiteIntegration/WebsiteContentItem references.
    await prisma.websiteContentItem.deleteMany({ where: { featureId: featureRes.body.id } });
    await prisma.websiteIntegration.deleteMany({ where: { featureId: featureRes.body.id } });
    await prisma.feature.delete({ where: { id: featureRes.body.id } });
  });

  it("marks the item failed (but still stores it locally) when the external API rejects the call", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" } as Response);

    const res = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A" });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");

    const faqsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "FAQS" } } });
    const stored = await prisma.websiteContentItem.findFirst({ where: { tenantId: tenant.id, featureId: faqsFeature.id } });
    expect(stored).not.toBeNull();
    expect(stored!.syncStatus).toBe("failed");
  });

  // Regression coverage for the auto-retry fix: POST always creates a new
  // resource, so if a transient failure were auto-retried the same way
  // idempotent methods are, a create that actually succeeded on a later
  // attempt after an earlier one "failed" (e.g. the response was lost, not
  // the request) could produce a duplicate on the tenant's own site with no
  // way to detect it. Proven here by mocking the very next call to succeed
  // and confirming it's never reached — POST fails on the first attempt.
  it("does NOT auto-retry POST — a transient failure fails immediately rather than risking a duplicate create", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "temporarily unavailable" } as Response);
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "faq-1" }) } as Response);

    const res = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A" });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Idempotent methods (GET/PUT/PATCH/DELETE always send the complete
  // resource here, never a partial diff — see pushUpdate) are safe to
  // auto-retry: redoing one after a transient failure produces the same
  // end state either way. Proven by mocking a 503 on the first attempt and
  // a success on the second, then confirming the update actually recovers.
  it("auto-retries a transient failure on an idempotent method (PUT) and succeeds on the next attempt", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "Post", content: "Body" });
    expect(created.status).toBe(201);

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "temporarily unavailable" } as Response);
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);

    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ title: "Post v2", content: "Body v2" });

    expect(updated.status).toBe(200);
    expect(updated.body.syncStatus).toBe("synced");
    // 1 create call + 2 update attempts (first 503, then success) = 3 total.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 10000);

  // Regression test: a "successful" HTTP response with no id/externalId in
  // the body must never produce syncStatus "synced" + externalId null —
  // that combination leaves the item permanently unreachable for future
  // updates/deletes (their URL is built from externalId). See
  // websiteApiClient.ts's callWebsiteApi POST branch.
  it("marks the item failed when the external API reports success but returns no id/externalId", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true }) } as Response);

    const res = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Q", answer: "A" });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");
    expect(res.body.externalId).toBeNull();
    expect(res.body.lastError).toContain("no id/externalId was found");

    const faqsFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "FAQS" } } });
    const stored = await prisma.websiteContentItem.findFirst({ where: { tenantId: tenant.id, featureId: faqsFeature.id } });
    expect(stored).not.toBeNull();
    // The specific invariant this bug violated: synced + externalId null
    // must never both be true.
    expect(stored!.syncStatus === "synced" && stored!.externalId === null).toBe(false);
    expect(stored!.syncStatus).toBe("failed");
    expect(stored!.externalId).toBeNull();
  });

  it("updates and deletes an item, pushing PUT/DELETE to the external API", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${itemId}`)
      .set("Cookie", cookie)
      .send({ title: "Updated post", content: "Hello again" });
    expect(updated.status).toBe(200);
    const [updateUrl, updateInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe(`https://example.com/api/blogs/blog-ext-1`);
    expect(updateInit.method).toBe("PUT");

    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
    const [deleteUrl, deleteInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    expect(deleteUrl).toBe(`https://example.com/api/blogs/blog-ext-1`);
    expect(deleteInit.method).toBe("DELETE");

    const stored = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(stored).toBeNull();
  });

  // Regression coverage for the idempotent-DELETE fix: reproduced live
  // against a real server before this fix existed — a DELETE that actually
  // succeeds on the external site, but whose response is lost (timeout),
  // gets auto-retried; the retry lands on an already-gone resource and the
  // site correctly answers 404. Previously that 404 was reported as a
  // failure, leaving the local dashboard row present (marked "failed")
  // while the external site had already removed the item — a real,
  // confirmed divergence. A DELETE 404 now means "already in the desired
  // end state" and is treated as success.
  it("treats a 404 on DELETE as success — the resource is already gone (idempotent delete)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ ok: false, error: "not found" }) } as Response);
    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);

    expect(deleted.status).toBe(204);
    const stored = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(stored).toBeNull();
  });

  it("does NOT treat a 404 on PUT/PATCH as success — updating something that doesn't exist is a real failure", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello" });
    const itemId = created.body.id;

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ ok: false, error: "not found" }) } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${itemId}`)
      .set("Cookie", cookie)
      .send({ title: "Updated post", content: "Hello again" });

    expect(updated.status).toBe(502);
    const stored = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(stored).not.toBeNull();
    expect(stored!.syncStatus).toBe("failed");
    expect(stored!.lastError).toContain("404");
  });

  // Regression coverage for a live bug: a real free-tier host (Render)
  // going cold made a write-back PATCH/DELETE take ~40s (two sequential
  // 20s timeouts back-to-back, immediately retried) before failing anyway
  // — a bad wait for a UI-blocking request, and the immediate retry could
  // never have helped since a still-booting host needs wall-clock time,
  // not a second request. Fixed by not auto-retrying a write-back timeout
  // at all (only a genuine network/5xx error still gets its one retry) —
  // fail clearly once instead of doubling the wait for no benefit.
  it("does NOT retry a DELETE after a timeout — fails immediately with a clear message, item stays as-is", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "First post", content: "Hello" });
    const itemId = created.body.id;

    // Simulate the client-side timeout (AbortError) that fires when a
    // response never arrives in time — no second mock queued, since a
    // retry should never happen.
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchSpy.mockRejectedValueOnce(abortError);

    const deleted = await request(app).delete(`/api/website-content/BLOGS/${itemId}`).set("Cookie", cookie);

    expect(deleted.status).toBe(502);
    expect(deleted.body.error).toMatch(/didn't respond within/);
    // Exactly 1 fetch call for the delete (1 create + 1 delete attempt = 2 total) — no retry.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const stored = await prisma.websiteContentItem.findUnique({ where: { id: itemId } });
    expect(stored).not.toBeNull();
    expect(stored!.syncStatus).toBe("failed");
    expect(stored!.lastError).toMatch(/didn't respond within/);
  });

  // Regression coverage for a live bug: editing a locally-failed-create
  // item (externalId still null — its original POST never actually
  // reached the external site) went straight to pushUpdate, which PATCHes
  // `${baseUrl}/${externalId}` — with externalId null, that collapses to
  // the bare collection URL, which naturally 404s ("PATCH /api/products"
  // isn't a route). syncItems already branched correctly on externalId;
  // updateItem (the direct edit-form path) didn't.
  it("PATCHing an item that was never actually created externally (externalId still null) retries the CREATE, not an update", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });

    // Simulates a create whose original POST failed before ever reaching
    // the external site (e.g. it was offline at the time) — kept locally
    // as "failed" with no externalId, exactly like pushCreate would leave it.
    const failedItem = await prisma.websiteContentItem.create({
      data: {
        tenantId: tenant.id,
        featureId: integration.featureId,
        externalId: null,
        payload: JSON.stringify({ title: "Draft post", content: "Written while the site was down" }),
        syncStatus: "failed",
        lastError: "External API error: connection refused",
      },
    });

    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "blog-ext-99" }) } as Response);
    const res = await request(app)
      .patch(`/api/website-content/BLOGS/${failedItem.id}`)
      .set("Cookie", cookie)
      .send({ title: "Draft post", content: "Written while the site was down" });

    expect(res.status).toBe(200);
    expect(res.body.syncStatus).toBe("synced");

    // The one and only outbound call was a POST to the bare collection
    // URL — never a PATCH/PUT to a URL built from a null externalId.
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/blogs");
    expect(init.method).toBe("POST");

    const stored = await prisma.websiteContentItem.findUnique({ where: { id: failedItem.id } });
    expect(stored!.externalId).toBe("blog-ext-99");
    expect(stored!.syncStatus).toBe("synced");

    // Now that it has a real externalId, editing it again correctly PATCHes/PUTs
    // the item-level URL instead of POST-ing a duplicate.
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    const secondEdit = await request(app)
      .patch(`/api/website-content/BLOGS/${failedItem.id}`)
      .set("Cookie", cookie)
      .send({ title: "Published post", content: "Site is back up" });
    expect(secondEdit.status).toBe(200);
    const [url2, init2] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe("https://example.com/api/blogs/blog-ext-99");
    expect(init2.method).toBe("PUT");
  });

  // Same root cause, same fix shape as the PATCH regression above: an item
  // that was never actually created externally (externalId still null) has
  // nothing to delete on the external site — deleteItem used to send DELETE
  // to the bare collection URL regardless (externalId ? base/id : base),
  // which happened to 404 (and get swallowed by the idempotent-DELETE-404
  // handling) against the real API that surfaced this, but isn't guaranteed
  // harmless against every API a tenant might connect.
  it("DELETEing an item that was never actually created externally (externalId still null) removes it locally with no outbound call at all", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    const failedItem = await prisma.websiteContentItem.create({
      data: {
        tenantId: tenant.id,
        featureId: integration.featureId,
        externalId: null,
        payload: JSON.stringify({ title: "Draft post", content: "Written while the site was down" }),
        syncStatus: "failed",
        lastError: "External API error: connection refused",
      },
    });

    const res = await request(app).delete(`/api/website-content/BLOGS/${failedItem.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(fetchSpy).not.toHaveBeenCalled();

    const stored = await prisma.websiteContentItem.findUnique({ where: { id: failedItem.id } });
    expect(stored).toBeNull();
  });

  it("a create whose success response has no id/externalId is marked failed, not silently stored with a wrong externalId", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    const failedItem = await prisma.websiteContentItem.create({
      data: {
        tenantId: tenant.id,
        featureId: integration.featureId,
        externalId: null,
        payload: JSON.stringify({ title: "Draft post", content: "Body" }),
        syncStatus: "failed",
        lastError: "External API error: connection refused",
      },
    });

    // A 200 with no id anywhere in the body — malformed/unexpected shape.
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ status: "ok" }) } as Response);
    const res = await request(app)
      .patch(`/api/website-content/BLOGS/${failedItem.id}`)
      .set("Cookie", cookie)
      .send({ title: "Draft post", content: "Body" });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/no id\/externalId was found/);
    const stored = await prisma.websiteContentItem.findUnique({ where: { id: failedItem.id } });
    expect(stored!.externalId).toBeNull();
    expect(stored!.syncStatus).toBe("failed");
  });

  it("treats CONTACT_DETAILS as a singleton — a second POST updates the existing record", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "CONTACT_DETAILS", "https://example.com/api/contact", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "contact-1" }) } as Response);

    const first = await request(app)
      .post("/api/website-content/CONTACT_DETAILS")
      .set("Cookie", cookie)
      .send({ phone: "+919800000001" });
    const second = await request(app)
      .post("/api/website-content/CONTACT_DETAILS")
      .set("Cookie", cookie)
      .send({ phone: "+919800000002" });

    expect(second.body.id).toBe(first.body.id);
    const contactFeature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "CONTACT_DETAILS" } } });
    const all = await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id, featureId: contactFeature.id } });
    expect(all).toHaveLength(1);
    expect(all[0].payload).toContain("+919800000002");
  });

  it("never appends an id segment to a singleton's write-back URL, even once it has an externalId (bare baseUrl, not baseUrl/:id)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "CONTACT_DETAILS", "https://example.com/api/contact", { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "contact-1" }) } as Response);

    await request(app).post("/api/website-content/CONTACT_DETAILS").set("Cookie", cookie).send({ phone: "+919800000001" });
    // The second write is a real update (pushUpdate) against a record that
    // now has an externalId — the exact situation that used to get
    // baseUrl/:externalId appended for a singleton, 404ing against an
    // external API whose singleton route is only ever the bare baseUrl.
    await request(app).post("/api/website-content/CONTACT_DETAILS").set("Cookie", cookie).send({ phone: "+919800000002" });

    const secondCallUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondCallUrl).toBe("https://example.com/api/contact");
  });

  it("keeps content items and module availability fully isolated per tenant", async () => {
    const tenantA = await createTenantWithAdmin("Content Tenant A");
    const tenantB = await createTenantWithAdmin("Content Tenant B");
    const cookieA = await loginAs(tenantA.admin.email);
    const cookieB = await loginAs(tenantB.admin.email);
    await configureIntegration(tenantA.tenant.id, "TESTIMONIALS", undefined, { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "t-1" }) } as Response);

    await request(app)
      .post("/api/website-content/TESTIMONIALS")
      .set("Cookie", cookieA)
      .send({ customerName: "A's customer", quote: "Great!" });

    // Tenant B has no integration configured for TESTIMONIALS at all.
    const bModules = await request(app).get("/api/website-content/modules").set("Cookie", cookieB);
    expect(bModules.body).toEqual([]);
    const bList = await request(app).get("/api/website-content/TESTIMONIALS").set("Cookie", cookieB);
    expect(bList.status).toBe(404);

    const aList = await request(app).get("/api/website-content/TESTIMONIALS").set("Cookie", cookieA);
    expect(aList.status).toBe(200);
    expect(aList.body.items).toHaveLength(1);
  });

  it("returns 404 (not the other tenant's data) when editing an item id that belongs to another tenant", async () => {
    const tenantA = await createTenantWithAdmin("Content Tenant A2");
    const tenantB = await createTenantWithAdmin("Content Tenant B2");
    const cookieA = await loginAs(tenantA.admin.email);
    const cookieB = await loginAs(tenantB.admin.email);
    await configureIntegration(tenantA.tenant.id, "TESTIMONIALS", undefined, { permissionLevel: "MANAGE" });
    await configureIntegration(tenantB.tenant.id, "TESTIMONIALS", undefined, { permissionLevel: "MANAGE" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "t-2" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/TESTIMONIALS")
      .set("Cookie", cookieA)
      .send({ customerName: "A's customer", quote: "Great!" });
    const itemId = created.body.id;

    const hijackPatch = await request(app)
      .patch(`/api/website-content/TESTIMONIALS/${itemId}`)
      .set("Cookie", cookieB)
      .send({ customerName: "Hijacked" });
    expect(hijackPatch.status).toBe(404);

    const hijackDelete = await request(app).delete(`/api/website-content/TESTIMONIALS/${itemId}`).set("Cookie", cookieB);
    expect(hijackDelete.status).toBe(404);
  });

  it("a VIEW-permission integration allows reads but blocks writes; MANAGE allows both", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "OFFERS", "https://example.com/api/offers"); // permissionLevel defaults to VIEW

    const list = await request(app).get("/api/website-content/OFFERS").set("Cookie", cookie);
    expect(list.status).toBe(200);
    const write = await request(app).post("/api/website-content/OFFERS").set("Cookie", cookie).send({ title: "Diwali Sale" });
    expect(write.status).toBe(403);

    await prisma.websiteIntegration.update({ where: { id: integration.id }, data: { permissionLevel: "MANAGE" } });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "offer-1" }) } as Response);
    const writeAfterPromotion = await request(app)
      .post("/api/website-content/OFFERS")
      .set("Cookie", cookie)
      .send({ title: "Diwali Sale" });
    expect(writeAfterPromotion.status).toBe(201);
  });

  it("uses a configured PATCH endpoint override for updates instead of the default PUT convention", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    await prisma.websiteIntegrationEndpoint.create({
      data: { integrationId: integration.id, method: "PATCH", url: "https://example.com/api/blogs/custom-patch" },
    });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "blog-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "Post", content: "Body" });

    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ title: "Post v2", content: "Body v2" });
    expect(updated.status).toBe(200);

    const [updateUrl, updateInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    // Uses the overridden URL, not `${baseUrl}/${externalId}`, and PATCH not PUT.
    expect(updateUrl).toBe("https://example.com/api/blogs/custom-patch");
    expect(updateInit.method).toBe("PATCH");
  });

  // Regression coverage for the path-parameter substitution fix: a custom
  // override URL previously had no way to reference the item's externalId
  // except by convention (baseUrl/externalId), so any tenant site needing
  // the id somewhere other than a trailing path segment (a query param,
  // here) could never be addressed correctly via an override.
  it("substitutes a literal {id} in a configured override URL with the item's externalId", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "BLOGS", "https://example.com/api/blogs", { permissionLevel: "MANAGE" });
    await prisma.websiteIntegrationEndpoint.create({
      data: { integrationId: integration.id, method: "PUT", url: "https://example.com/api/blogs/update?id={id}" },
    });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "blog-1" }) } as Response);

    const created = await request(app)
      .post("/api/website-content/BLOGS")
      .set("Cookie", cookie)
      .send({ title: "Post", content: "Body" });

    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);
    const updated = await request(app)
      .patch(`/api/website-content/BLOGS/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ title: "Post v2", content: "Body v2" });
    expect(updated.status).toBe(200);

    const [updateUrl, updateInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://example.com/api/blogs/update?id=blog-1");
    expect(updateInit.method).toBe("PUT");
  });

  it("uses a per-method GET endpoint override (distinct from baseUrl) for import, with its own auth", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const integration = await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories", { permissionLevel: "MANAGE" });
    await prisma.websiteIntegrationEndpoint.create({
      data: {
        integrationId: integration.id,
        method: "GET",
        url: "https://example.com/api/public/categories-list",
        authType: "apiKey",
        encryptedCredentials: encryptCredentials({ headerName: "X-Public-Key", apiKey: "list-only-key" }),
      },
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: [{ id: "cat-1", name: "Silk" }] }),
    } as Response);

    const res = await request(app).post("/api/website-content/CATEGORIES/import").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // Import always appends page/pageSize for the pagination loop (see
    // fetchWebsiteApi) — a site that doesn't paginate just ignores them.
    expect(url).toBe("https://example.com/api/public/categories-list?page=1&pageSize=100");
    expect((init.headers as Record<string, string>)["X-Public-Key"]).toBe("list-only-key");
  });
});
