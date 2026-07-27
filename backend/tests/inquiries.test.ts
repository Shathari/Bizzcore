import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("Public booking request submission — POST /api/public/inquiries/:tenantId", () => {
  it("creates an inquiry with source WEBSITE by default", async () => {
    const { tenant } = await createTenantWithAdmin();

    const res = await request(app)
      .post(`/api/public/inquiries/${tenant.id}`)
      .send({ message: "Looking to book a bridal fitting for Dec 5th", contactName: "Priya Sharma", contactPhone: "+919800000100" });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const inquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(inquiry).toMatchObject({
      tenantId: tenant.id,
      source: "WEBSITE",
      status: "open",
      message: "Looking to book a bridal fitting for Dec 5th",
      contactName: "Priya Sharma",
      contactPhone: "+919800000100",
      customerId: null,
    });
  });

  it("rejects an empty message with 400", async () => {
    const { tenant } = await createTenantWithAdmin();

    const res = await request(app).post(`/api/public/inquiries/${tenant.id}`).send({ message: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown tenant id", async () => {
    const res = await request(app)
      .post("/api/public/inquiries/not-a-real-tenant-id")
      .send({ message: "Anyone home?" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid preferredAt with 400", async () => {
    const { tenant } = await createTenantWithAdmin();

    const res = await request(app)
      .post(`/api/public/inquiries/${tenant.id}`)
      .send({ message: "Book me in", preferredAt: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("auto-links to an existing customer by exact phone match", async () => {
    const { tenant } = await createTenantWithAdmin();
    const customer = await createTestCustomer(tenant.id, { name: "Existing Customer", phone: "+919800000101" });

    const res = await request(app)
      .post(`/api/public/inquiries/${tenant.id}`)
      .send({ message: "Rebooking a fitting", contactPhone: "+919800000101" });

    expect(res.status).toBe(201);
    const inquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(inquiry.customerId).toBe(customer.id);
  });

  it("never surfaces one tenant's inquiries through another tenant's submission", async () => {
    const { tenant: tenantA } = await createTenantWithAdmin("Boutique A");
    const { tenant: tenantB } = await createTenantWithAdmin("Boutique B");

    await request(app).post(`/api/public/inquiries/${tenantA.id}`).send({ message: "For A only" });

    const countA = await prisma.inquiry.count({ where: { tenantId: tenantA.id } });
    const countB = await prisma.inquiry.count({ where: { tenantId: tenantB.id } });
    expect(countA).toBe(1);
    expect(countB).toBe(0);
  });
});

describe("Booking requests dashboard — /api/inquiries", () => {
  async function submitInquiry(tenantId: string, overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post(`/api/public/inquiries/${tenantId}`)
      .send({ message: "Default booking message", contactName: "Default Contact", ...overrides });
    return res.body.id as string;
  }

  it("lists only this tenant's own inquiries, most recent first", async () => {
    const { tenant: tenantA, admin: adminA } = await createTenantWithAdmin("Boutique A");
    const { tenant: tenantB } = await createTenantWithAdmin("Boutique B");
    const cookieA = await loginAs(adminA.email);

    await submitInquiry(tenantA.id, { message: "First" });
    await submitInquiry(tenantA.id, { message: "Second" });
    await submitInquiry(tenantB.id, { message: "Not visible to A" });

    const res = await request(app).get("/api/inquiries").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((i: { tenantId: string }) => i.tenantId === tenantA.id)).toBe(true);
    expect(res.body[0].message).toBe("Second"); // most recent first
  });

  it("filters by status and source", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const id = await submitInquiry(tenant.id, { message: "To close" });
    await request(app).patch(`/api/inquiries/${id}/status`).set("Cookie", cookie).send({ status: "closed" });
    await submitInquiry(tenant.id, { message: "Still open" });

    const closedOnly = await request(app).get("/api/inquiries?status=closed").set("Cookie", cookie);
    expect(closedOnly.body).toHaveLength(1);
    expect(closedOnly.body[0].message).toBe("To close");

    const websiteOnly = await request(app).get("/api/inquiries?source=WEBSITE").set("Cookie", cookie);
    expect(websiteOnly.body).toHaveLength(2);
  });

  it("returns 404 for another tenant's inquiry id", async () => {
    const { tenant: tenantA } = await createTenantWithAdmin("Boutique A");
    const { admin: adminB } = await createTenantWithAdmin("Boutique B");
    const cookieB = await loginAs(adminB.email);
    const id = await submitInquiry(tenantA.id);

    const getRes = await request(app).get(`/api/inquiries/${id}`).set("Cookie", cookieB);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app).patch(`/api/inquiries/${id}/status`).set("Cookie", cookieB).send({ status: "closed" });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/inquiries/${id}`).set("Cookie", cookieB);
    expect(deleteRes.status).toBe(404);
  });

  it("updates status through the valid open -> followed_up -> closed states, rejects an invalid one", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const id = await submitInquiry(tenant.id);

    const followUp = await request(app).patch(`/api/inquiries/${id}/status`).set("Cookie", cookie).send({ status: "followed_up" });
    expect(followUp.status).toBe(200);
    expect(followUp.body.status).toBe("followed_up");

    const bad = await request(app).patch(`/api/inquiries/${id}/status`).set("Cookie", cookie).send({ status: "archived" });
    expect(bad.status).toBe(400);
  });

  it("deletes an inquiry", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const id = await submitInquiry(tenant.id);

    const del = await request(app).delete(`/api/inquiries/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const getRes = await request(app).get(`/api/inquiries/${id}`).set("Cookie", cookie);
    expect(getRes.status).toBe(404);
  });

  describe("POST /:id/convert-to-customer", () => {
    it("creates a Customer from the inquiry's contact info and links it back", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      const id = await submitInquiry(tenant.id, {
        contactName: "Priya Sharma",
        contactPhone: "+919800000102",
        contactEmail: "priya@example.com",
        message: "Bridal fitting on the 5th",
      });

      const res = await request(app).post(`/api/inquiries/${id}/convert-to-customer`).set("Cookie", cookie);
      expect(res.status).toBe(201);
      expect(res.body.customerId).toBeTruthy();
      expect(res.body.status).toBe("followed_up");
      expect(res.body.customer).toMatchObject({ name: "Priya Sharma" });

      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: res.body.customerId } });
      expect(customer).toMatchObject({ tenantId: tenant.id, name: "Priya Sharma", email: "priya@example.com", segment: "Regular" });
    });

    it("rejects converting an inquiry with no phone on file", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      const id = await submitInquiry(tenant.id, { contactPhone: undefined });

      const res = await request(app).post(`/api/inquiries/${id}/convert-to-customer`).set("Cookie", cookie);
      expect(res.status).toBe(400);
    });

    it("rejects converting an inquiry that's already linked to a customer", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);
      const id = await submitInquiry(tenant.id, { contactPhone: "+919800000103" });
      await request(app).post(`/api/inquiries/${id}/convert-to-customer`).set("Cookie", cookie);

      const second = await request(app).post(`/api/inquiries/${id}/convert-to-customer`).set("Cookie", cookie);
      expect(second.status).toBe(400);
    });
  });
});
