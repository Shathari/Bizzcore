import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("custom development request queue", () => {
  it("exposes the 7 reference service types with display-only price ranges", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get("/api/subscription/custom-development/service-types").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    const apiIntegration = res.body.find((s: { key: string }) => s.key === "API_INTEGRATION");
    expect(apiIntegration.priceRange).toContain("₹8,000");
  });

  it("a tenant admin can submit a request, and it starts life as Requested with no quote", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/subscription/custom-development")
      .set("Cookie", cookie)
      .send({ serviceType: "NEW_MODULE", description: "We need a loyalty points module." });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Requested");
    expect(res.body.quotedAmount).toBeNull();
    expect(res.body.requestedBy).toBe(admin.id);
    expect(res.body.tenantId).toBe(tenant.id);
  });

  it("rejects a request with an unknown service type or empty description", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const badType = await request(app)
      .post("/api/subscription/custom-development")
      .set("Cookie", cookie)
      .send({ serviceType: "NOT_A_REAL_TYPE", description: "Something" });
    expect(badType.status).toBe(400);

    const emptyDescription = await request(app)
      .post("/api/subscription/custom-development")
      .set("Cookie", cookie)
      .send({ serviceType: "UI_CHANGE", description: "" });
    expect(emptyDescription.status).toBe(400);
  });

  it("blocks a regular ADMIN from the Super Admin queue with 403", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get("/api/super-admin/custom-development").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("Super Admin sees the request in the cross-tenant queue, quotes it, and the tenant sees the update", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const tenantCookie = await loginAs(admin.email);
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);

    const created = await request(app)
      .post("/api/subscription/custom-development")
      .set("Cookie", tenantCookie)
      .send({ serviceType: "API_INTEGRATION", description: "Connect our POS system." });

    const queueRes = await request(app).get("/api/super-admin/custom-development").set("Cookie", superCookie);
    expect(queueRes.status).toBe(200);
    const inQueue = queueRes.body.find((r: { id: string }) => r.id === created.body.id);
    expect(inQueue).toBeDefined();
    expect(inQueue.tenant.businessName).toBe(tenant.businessName);

    const updateRes = await request(app)
      .patch(`/api/super-admin/custom-development/${created.body.id}`)
      .set("Cookie", superCookie)
      .send({ status: "Quoted", quotedAmount: 15000, notes: "Standard REST integration, 2 week turnaround." });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("Quoted");
    expect(updateRes.body.quotedAmount).toBe(15000);

    const auditRows = await prisma.auditLog.findMany({ where: { action: "CUSTOM_DEV_REQUEST_UPDATED", targetTenantId: tenant.id } });
    expect(auditRows).toHaveLength(1);

    const myRequests = await request(app).get("/api/subscription/custom-development").set("Cookie", tenantCookie);
    expect(myRequests.body[0].status).toBe("Quoted");
    expect(myRequests.body[0].quotedAmount).toBe(15000);
  });

  it("the Super Admin queue supports filtering by status", async () => {
    const tenantA = await createTenantWithAdmin("CustomDev A");
    const cookieA = await loginAs(tenantA.admin.email);
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);

    await request(app)
      .post("/api/subscription/custom-development")
      .set("Cookie", cookieA)
      .send({ serviceType: "SCHEMA_CHANGE", description: "Add a loyalty_points column." });

    const requestedOnly = await request(app).get("/api/super-admin/custom-development").query({ status: "Requested" }).set("Cookie", superCookie);
    expect(requestedOnly.body.some((r: { tenantId: string }) => r.tenantId === tenantA.tenant.id)).toBe(true);

    const cancelledOnly = await request(app).get("/api/super-admin/custom-development").query({ status: "Cancelled" }).set("Cookie", superCookie);
    expect(cancelledOnly.body.some((r: { tenantId: string }) => r.tenantId === tenantA.tenant.id)).toBe(false);
  });

  it("tenant isolation: a tenant only ever sees its own requests", async () => {
    const tenantA = await createTenantWithAdmin("Isolation A");
    const tenantB = await createTenantWithAdmin("Isolation B");
    const cookieA = await loginAs(tenantA.admin.email);
    const cookieB = await loginAs(tenantB.admin.email);

    await request(app).post("/api/subscription/custom-development").set("Cookie", cookieA).send({ serviceType: "UI_CHANGE", description: "Tenant A's request" });
    await request(app).post("/api/subscription/custom-development").set("Cookie", cookieB).send({ serviceType: "UI_CHANGE", description: "Tenant B's request" });

    const listA = await request(app).get("/api/subscription/custom-development").set("Cookie", cookieA);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].description).toBe("Tenant A's request");
  });
});
