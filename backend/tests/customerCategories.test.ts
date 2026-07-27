import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, createTestCustomer, TEST_PASSWORD } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("Customer Categories — /api/customer-categories", () => {
  it("seeds Regular/VIP/Bridal as built-ins on first access, tenant-scoped", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email, TEST_PASSWORD);

    const res = await request(app).get("/api/customer-categories").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { name: string }) => c.name).sort()).toEqual(["Bridal", "Regular", "VIP"]);
    expect(res.body.every((c: { isBuiltIn: boolean }) => c.isBuiltIn)).toBe(true);
    expect(res.body.find((c: { name: string }) => c.name === "VIP").isPriority).toBe(true);
    expect(res.body.find((c: { name: string }) => c.name === "Regular").isPriority).toBe(false);

    const rows = await prisma.customerCategory.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(3);
  });

  it("isolates categories per tenant", async () => {
    const { admin: adminA } = await createTenantWithAdmin("Tenant A");
    const { admin: adminB } = await createTenantWithAdmin("Tenant B");
    const cookieA = await loginAs(adminA.email, TEST_PASSWORD);
    const cookieB = await loginAs(adminB.email, TEST_PASSWORD);

    await request(app).post("/api/customer-categories").set("Cookie", cookieA).send({ name: "Corporate" });

    const listA = await request(app).get("/api/customer-categories").set("Cookie", cookieA);
    const listB = await request(app).get("/api/customer-categories").set("Cookie", cookieB);
    expect(listA.body.map((c: { name: string }) => c.name)).toContain("Corporate");
    expect(listB.body.map((c: { name: string }) => c.name)).not.toContain("Corporate");
  });

  it("creates a custom category and rejects a case-insensitive duplicate name", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email, TEST_PASSWORD);

    const created = await request(app).post("/api/customer-categories").set("Cookie", cookie).send({ name: "Corporate" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Corporate", isBuiltIn: false, isPriority: false });

    const dupe = await request(app).post("/api/customer-categories").set("Cookie", cookie).send({ name: "corporate" });
    expect(dupe.status).toBe(400);
  });

  it("renaming a category cascades to Customer.segment and ScheduledContent.targetSegment", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email, TEST_PASSWORD);

    const list = await request(app).get("/api/customer-categories").set("Cookie", cookie);
    const bridal = list.body.find((c: { name: string }) => c.name === "Bridal");

    const customer = await createTestCustomer(tenant.id, { name: "Renamed Segment Customer", phone: "+919800000201", segment: "Bridal" });
    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Hi {{name}}",
        targetSegment: "Bridal",
        scheduledAt: new Date(Date.now() + 3600_000),
      },
    });

    const renamed = await request(app)
      .patch(`/api/customer-categories/${bridal.id}`)
      .set("Cookie", cookie)
      .send({ name: "Wedding Client" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Wedding Client");

    const updatedCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(updatedCustomer.segment).toBe("Wedding Client");

    const updatedBroadcast = await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } });
    expect(updatedBroadcast.targetSegment).toBe("Wedding Client");
  });

  it("toggles isPriority without touching the name", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email, TEST_PASSWORD);

    const list = await request(app).get("/api/customer-categories").set("Cookie", cookie);
    const regular = list.body.find((c: { name: string }) => c.name === "Regular");
    expect(regular.isPriority).toBe(false);

    const res = await request(app).patch(`/api/customer-categories/${regular.id}`).set("Cookie", cookie).send({ isPriority: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Regular", isPriority: true });
  });

  it("blocks deleting a category that's still in use, allows it once unused", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email, TEST_PASSWORD);

    const list = await request(app).get("/api/customer-categories").set("Cookie", cookie);
    const vip = list.body.find((c: { name: string }) => c.name === "VIP");

    await createTestCustomer(tenant.id, { name: "VIP Customer", phone: "+919800000202", segment: "VIP" });

    const blocked = await request(app).delete(`/api/customer-categories/${vip.id}`).set("Cookie", cookie);
    expect(blocked.status).toBe(400);

    await prisma.customer.updateMany({ where: { tenantId: tenant.id, segment: "VIP" }, data: { segment: "Regular" } });

    const deleted = await request(app).delete(`/api/customer-categories/${vip.id}`).set("Cookie", cookie);
    expect(deleted.status).toBe(204);
  });

  it("returns 404 for a category belonging to another tenant", async () => {
    const { admin: adminA } = await createTenantWithAdmin("Tenant A");
    const { admin: adminB } = await createTenantWithAdmin("Tenant B");
    const cookieA = await loginAs(adminA.email, TEST_PASSWORD);
    const cookieB = await loginAs(adminB.email, TEST_PASSWORD);

    const listA = await request(app).get("/api/customer-categories").set("Cookie", cookieA);
    const categoryId = listA.body[0].id;

    const res = await request(app).patch(`/api/customer-categories/${categoryId}`).set("Cookie", cookieB).send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });
});
