import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";
import { app, createTenantWithAdmin, configureIntegration, loginAs, grantPermissivePlan, createCustomFeature } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { UPLOADS_ROOT, publicUrlFor } from "../src/lib/upload";

// End-to-end proof of the automatic media-sync pipeline (lib/mediaSync.ts,
// wired into lib/websiteContentService.ts's pushCreate/pushUpdate/
// pushRetryCreate): a local /uploads/... image field gets uploaded to the
// tenant's destination site (POST {origin}/api/public/admin/uploads) BEFORE
// the JSON record is pushed, the outbound payload carries the returned
// destination URL, the item's own local storage keeps the local path
// unchanged, an unchanged image is never re-uploaded, and an upload failure
// aborts the record entirely (never reaches the JSON push).
function createFakeUpload(tenantId: string, filename: string): string {
  const dir = path.join(UPLOADS_ROOT, tenantId, "website-content");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from("fake-image-bytes"));
  return publicUrlFor(tenantId, "website-content", filename);
}

describe("media sync: automatic image upload before JSON push", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("uploads a new image, sends the destination URL in the outbound JSON, and keeps the local path in storage", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://tenant-site.example/api/public/admin/products", { permissionLevel: "MANAGE" });
    const localPath = createFakeUpload(tenant.id, "prod-1.webp");

    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: "https://tenant-site.example/uploads/prod-1.webp" }) } as Response;
      }
      return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "ext-1" } }) } as Response;
    });

    const res = await request(app)
      .post("/api/website-content/PRODUCTS")
      .set("Cookie", cookie)
      .send({ name: "Test Saree", sku: "T-1", price: 999, image: localPath });

    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // upload, then create

    const [uploadUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(uploadUrl).toBe("https://tenant-site.example/api/public/admin/uploads");

    const [, createInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const sentBody = JSON.parse(createInit.body as string);
    expect(sentBody.image).toBe("https://tenant-site.example/uploads/prod-1.webp");

    // Local storage keeps the LOCAL path, never the destination URL.
    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: res.body.id } });
    const storedPayload = JSON.parse(stored.payload);
    expect(storedPayload.image).toBe(localPath);
    expect(JSON.parse(stored.mediaUploads!).image).toEqual({
      localPath,
      destinationUrl: "https://tenant-site.example/uploads/prod-1.webp",
    });
  });

  it("does not re-upload an unchanged image on a later sync", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://tenant-site.example/api/public/admin/products", { permissionLevel: "MANAGE" });
    const localPath = createFakeUpload(tenant.id, "prod-2.webp");

    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: "https://tenant-site.example/uploads/prod-2.webp" }) } as Response;
      }
      return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "ext-1" } }) } as Response;
    });

    const created = await request(app)
      .post("/api/website-content/PRODUCTS")
      .set("Cookie", cookie)
      .send({ name: "A", sku: "S1", price: 100, image: localPath });
    expect(created.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockClear();
    fetchSpy.mockImplementation(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: { id: "ext-1" } }) }) as unknown as Response);

    const updated = await request(app)
      .patch(`/api/website-content/PRODUCTS/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ name: "A", sku: "S1", price: 150, image: localPath });
    expect(updated.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // PUT/PATCH only — no re-upload of the unchanged image
  });

  it("re-uploads when the image is replaced with a different local file", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://tenant-site.example/api/public/admin/products", { permissionLevel: "MANAGE" });
    const firstLocalPath = createFakeUpload(tenant.id, "first.webp");

    let uploadCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        uploadCount++;
        return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: `https://tenant-site.example/uploads/v${uploadCount}.webp` }) } as Response;
      }
      return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "ext-1" } }) } as Response;
    });

    const created = await request(app)
      .post("/api/website-content/PRODUCTS")
      .set("Cookie", cookie)
      .send({ name: "C", sku: "S3", price: 300, image: firstLocalPath });
    expect(created.status).toBe(201);
    expect(uploadCount).toBe(1);

    const secondLocalPath = createFakeUpload(tenant.id, "second.webp");
    const updated = await request(app)
      .patch(`/api/website-content/PRODUCTS/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ name: "C", sku: "S3", price: 300, image: secondLocalPath });
    expect(updated.status).toBe(200);
    expect(uploadCount).toBe(2); // cache miss on the new local path — re-uploaded

    const [, updateInit] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as [string, RequestInit];
    const sentBody = JSON.parse(updateInit.body as string);
    expect(sentBody.image).toBe("https://tenant-site.example/uploads/v2.webp"); // old destination URL superseded
  });

  it("marks the record failed and never sends the JSON push when the image upload fails", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://tenant-site.example/api/public/admin/products", { permissionLevel: "MANAGE" });
    const localPath = createFakeUpload(tenant.id, "prod-3.webp");

    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        return { ok: false, status: 500, text: async () => "upload service unavailable" } as Response;
      }
      throw new Error("JSON push should never be attempted when the image upload fails");
    });

    const res = await request(app)
      .post("/api/website-content/PRODUCTS")
      .set("Cookie", cookie)
      .send({ name: "B", sku: "S2", price: 200, image: localPath });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");
    expect(res.body.lastError).toContain("Image upload failed");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the failed upload attempt — no JSON push

    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.externalId).toBeNull();
    // The failed field never got a cache entry — a retry will attempt it again.
    expect(JSON.parse(stored.mediaUploads ?? "{}")).toEqual({});
  });

  it("normalizes a root-relative destination URL to absolute before caching/sending it", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://tenant-site.example/api/public/admin/products", { permissionLevel: "MANAGE" });
    const localPath = createFakeUpload(tenant.id, "relative-test.webp");

    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        // A non-conforming destination that returns a root-relative path
        // instead of the documented absolute URL.
        return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: "/uploads/relative-test.webp" }) } as Response;
      }
      return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "ext-rel-1" } }) } as Response;
    });

    const res = await request(app)
      .post("/api/website-content/PRODUCTS")
      .set("Cookie", cookie)
      .send({ name: "Relative URL Test", sku: "REL-1", price: 500, image: localPath });

    expect(res.status).toBe(201);
    const [, createInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const sentBody = JSON.parse(createInit.body as string);
    expect(sentBody.image).toBe("https://tenant-site.example/uploads/relative-test.webp");

    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(JSON.parse(stored.mediaUploads!).image.destinationUrl).toBe("https://tenant-site.example/uploads/relative-test.webp");
  });

  it("uploads every image field on a feature, including multiple image fields in the same record", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await createCustomFeature(tenant.id, {
      key: "TEAM_MEMBERS",
      label: "Team Members",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "avatar", label: "Avatar", type: "image" },
        { key: "coverPhoto", label: "Cover Photo", type: "image" },
      ],
    });
    await configureIntegration(tenant.id, "TEAM_MEMBERS", "https://tenant-site.example/api/public/admin/team", { permissionLevel: "MANAGE" });

    const avatarPath = createFakeUpload(tenant.id, "avatar.webp");
    const coverPath = createFakeUpload(tenant.id, "cover.webp");
    const uploadedUrls: string[] = [];

    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        const destUrl = `https://tenant-site.example/uploads/team-${uploadedUrls.length + 1}.webp`;
        uploadedUrls.push(destUrl);
        return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: destUrl }) } as Response;
      }
      return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "team-ext-1" } }) } as Response;
    });

    const res = await request(app)
      .post("/api/website-content/TEAM_MEMBERS")
      .set("Cookie", cookie)
      .send({ name: "Jane Doe", avatar: avatarPath, coverPhoto: coverPath });

    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 2 uploads + 1 create
    expect(uploadedUrls).toHaveLength(2);

    const [, createInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    const sentBody = JSON.parse(createInit.body as string);
    expect(sentBody.avatar).toBe(uploadedUrls[0]);
    expect(sentBody.coverPhoto).toBe(uploadedUrls[1]);

    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: res.body.id } });
    const cache = JSON.parse(stored.mediaUploads!);
    expect(cache.avatar).toEqual({ localPath: avatarPath, destinationUrl: uploadedUrls[0] });
    expect(cache.coverPhoto).toEqual({ localPath: coverPath, destinationUrl: uploadedUrls[1] });
  });

  it("preserves an already-uploaded field's cache entry when a different field's upload fails", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await createCustomFeature(tenant.id, {
      key: "EVENTS_TEST",
      label: "Events",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "banner", label: "Banner", type: "image" },
        { key: "thumbnail", label: "Thumbnail", type: "image" },
      ],
    });
    await configureIntegration(tenant.id, "EVENTS_TEST", "https://tenant-site.example/api/public/admin/events", { permissionLevel: "MANAGE" });

    const bannerPath = createFakeUpload(tenant.id, "banner.webp");
    const thumbPath = createFakeUpload(tenant.id, "thumb.webp");

    let uploadCallCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/public/admin/uploads")) {
        uploadCallCount++;
        // "banner" (declared first) succeeds; "thumbnail" (declared second)
        // fails — field processing follows the feature's own field order.
        if (uploadCallCount === 1) {
          return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, url: "https://tenant-site.example/uploads/banner-1.webp" }) } as Response;
        }
        return { ok: false, status: 500, text: async () => "thumbnail upload failed" } as Response;
      }
      throw new Error("JSON push should never be attempted when any image upload fails");
    });

    const res = await request(app)
      .post("/api/website-content/EVENTS_TEST")
      .set("Cookie", cookie)
      .send({ title: "Trunk Show", banner: bannerPath, thumbnail: thumbPath });

    expect(res.status).toBe(502);
    expect(res.body.syncStatus).toBe("failed");
    expect(res.body.lastError).toContain('field "thumbnail"');
    expect(uploadCallCount).toBe(2);

    const stored = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: res.body.id } });
    const cache = JSON.parse(stored.mediaUploads!);
    expect(cache.banner).toEqual({ localPath: bannerPath, destinationUrl: "https://tenant-site.example/uploads/banner-1.webp" });
    expect(cache.thumbnail).toBeUndefined(); // the failed field never got a cache entry
  });

  it("behaves exactly as before for a feature with no image field", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "CATEGORIES", "https://tenant-site.example/api/public/admin/categories", { permissionLevel: "MANAGE" });

    fetchSpy.mockResolvedValue({ ok: true, status: 201, text: async () => JSON.stringify({ ok: true, data: { id: "cat-ext-1" } }) } as Response);

    const res = await request(app).post("/api/website-content/CATEGORIES").set("Cookie", cookie).send({ name: "Silk" });
    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // JSON push only — upload endpoint never contacted
  });
});
