import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, configureIntegration, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";

// The connector equivalent of the Customer PII AccessLog trail — one row
// per credential save/replace, Test Connection, schema discovery, and sync
// (import/export). See lib/connectorAccessLog.ts.
describe("connector access log", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("logs CREDENTIAL_SAVED when a real credential is saved, attributed to the acting tenant Admin", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "bearer", credentials: { token: "SECRET-TOKEN" } });
    expect(res.status).toBe(200);

    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "BLOGS" } } });
    const logs = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, featureId: feature.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("CREDENTIAL_SAVED");
    expect(logs[0].outcome).toBe("success");
    expect(logs[0].actorId).toBe(admin.id);
    expect(JSON.stringify(logs[0].details)).not.toContain("SECRET-TOKEN"); // never the credential value

    // A follow-up save that only changes an unrelated field (no new
    // credentials) must NOT log another CREDENTIAL_SAVED row.
    await request(app)
      .put("/api/connector-config/BLOGS")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://example.com/api/blogs", authType: "bearer" });
    const logsAfter = await prisma.connectorAccessLog.findMany({ where: { tenantId: tenant.id, featureId: feature.id } });
    expect(logsAfter).toHaveLength(1);
  });

  it("logs TEST_CONNECTION with outcome + latency, and SCHEMA_DISCOVERY with outcome + field/record counts", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    await configureIntegration(tenant.id, "PRODUCTS", "https://example.com/api/products");

    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "[]" } as Response);
    const testRes = await request(app)
      .post("/api/connector-config/PRODUCTS/test")
      .set("Cookie", cookie)
      .send({ method: "GET", url: "https://example.com/api/products", authType: "none" });
    expect(testRes.status).toBe(200);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "1", name: "x" }] }),
    } as Response);
    const discoverRes = await request(app)
      .post("/api/connector-config/PRODUCTS/discover-schema")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/api/products", authType: "none" });
    expect(discoverRes.status).toBe(200);

    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "PRODUCTS" } } });
    const logs = await prisma.connectorAccessLog.findMany({
      where: { tenantId: tenant.id, featureId: feature.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.action)).toEqual(["TEST_CONNECTION", "SCHEMA_DISCOVERY"]);
    expect(logs.every((l) => l.outcome === "success")).toBe(true);
    expect(logs.every((l) => l.actorId === admin.id)).toBe(true);

    const testDetails = JSON.parse(logs[0].details!);
    expect(typeof testDetails.latencyMs).toBe("number");
    const discoverDetails = JSON.parse(logs[1].details!);
    expect(discoverDetails.fieldCount).toBe(2);
    expect(discoverDetails.recordCount).toBe(1);
  });

  it("logs SYNC_IMPORT on a pull and SYNC_EXPORT on a push, both queryable via GET .../access-log with actorLabel resolved", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });

    // Push (SYNC_EXPORT) via create.
    fetchSpy.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "ext-1" }) } as Response);
    const created = await request(app)
      .post("/api/website-content/FAQS")
      .set("Cookie", cookie)
      .send({ question: "Do you ship?", answer: "Yes" });
    expect(created.status).toBe(201);

    // Pull (SYNC_IMPORT).
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ data: [{ id: "ext-2", question: "Refunds?", answer: "Within 7 days" }] }),
    } as Response);
    const imported = await request(app).post("/api/website-content/FAQS/import").set("Cookie", cookie).send({});
    expect(imported.status).toBe(200);

    const res = await request(app)
      .get(`/api/super-admin/website-integrations/${tenant.id}/FAQS/access-log`)
      .set("Cookie", superCookie);
    expect(res.status).toBe(200);
    const actions = res.body.map((e: { action: string }) => e.action);
    expect(actions).toContain("SYNC_EXPORT");
    expect(actions).toContain("SYNC_IMPORT");
    // actorId belongs to the tenant Admin (owner), not the Super Admin
    // querying the log — actorLabel resolves it to a real name either way.
    const exportEntry = res.body.find((e: { action: string }) => e.action === "SYNC_EXPORT");
    expect(exportEntry.actorLabel).toBe(admin.name);
    expect(exportEntry.outcome).toBe("success");
  });

  it("blocks a regular ADMIN from the connector access-log route with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get(`/api/super-admin/website-integrations/${tenant.id}/FAQS/access-log`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
