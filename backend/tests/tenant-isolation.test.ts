import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, configureIntegration, loginAs, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { getFeatureByKey } from "../src/lib/featureCatalog";

// Codifies the manual cross-tenant audit performed at the end of the build
// as a real, regression-proof test — every cross-tenant attempt below must
// return 404 (never 403, never 200), per spec: existence of another
// tenant's records must never be confirmed to a caller who doesn't own them.
describe("tenant isolation", () => {
  it("returns 404 (not 403) for a cross-tenant customer GET and DELETE", async () => {
    const tenantA = await createTenantWithAdmin("Tenant A");
    const tenantB = await createTenantWithAdmin("Tenant B");
    const cookieA = await loginAs(tenantA.admin.email);

    const customerB = await createTestCustomer(tenantB.tenant.id, { name: "Rival Customer", phone: "+919800000001" });

    const getRes = await request(app).get(`/api/customers/${customerB.id}`).set("Cookie", cookieA);
    expect(getRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/customers/${customerB.id}`).set("Cookie", cookieA);
    expect(deleteRes.status).toBe(404);

    // Confirm it wasn't actually deleted despite the 404.
    const stillThere = await prisma.customer.findUnique({ where: { id: customerB.id } });
    expect(stillThere).not.toBeNull();

    // Same 404-not-403 rule applies to the PII reveal/call endpoints — a
    // tenant Admin must not be able to probe or decrypt another tenant's
    // customer data by guessing IDs, and no AccessLog row should be written
    // for a reveal that never actually happened.
    const revealRes = await request(app)
      .post(`/api/customers/${customerB.id}/reveal`)
      .set("Cookie", cookieA)
      .send({ field: "phone" });
    expect(revealRes.status).toBe(404);
    const callRes = await request(app).post(`/api/customers/${customerB.id}/call`).set("Cookie", cookieA);
    expect(callRes.status).toBe(404);
    const crossTenantLogs = await prisma.accessLog.findMany({ where: { customerId: customerB.id } });
    expect(crossTenantLogs).toHaveLength(0);

    const accessLogRes = await request(app).get(`/api/customers/${customerB.id}/access-log`).set("Cookie", cookieA);
    expect(accessLogRes.status).toBe(404);
  });

  it("returns 404 for cross-tenant website-content PATCH/DELETE (Products)", async () => {
    const tenantA = await createTenantWithAdmin("Tenant A2");
    const tenantB = await createTenantWithAdmin("Tenant B2");
    const cookieA = await loginAs(tenantA.admin.email);
    // Both tenants have PRODUCTS mapped so the 404 below is genuinely from
    // tenant-scoping, not from the module simply not being configured for A.
    await configureIntegration(tenantA.tenant.id, "PRODUCTS", "https://a-only.example.com/products", { permissionLevel: "MANAGE" });
    await configureIntegration(tenantB.tenant.id, "PRODUCTS", "https://b-only.example.com/products", { permissionLevel: "MANAGE" });
    const productsFeatureB = await getFeatureByKey(tenantB.tenant.id, "PRODUCTS");
    if (!productsFeatureB) throw new Error("expected a PRODUCTS feature to be cloned for tenant B");
    const productB = await prisma.websiteContentItem.create({
      data: { tenantId: tenantB.tenant.id, featureId: productsFeatureB.id, payload: JSON.stringify({ name: "Rival Saree", sku: "RIVAL-1", price: 1000 }) },
    });

    const patchRes = await request(app)
      .patch(`/api/website-content/PRODUCTS/${productB.id}`)
      .set("Cookie", cookieA)
      .send({ name: "Hijacked" });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/website-content/PRODUCTS/${productB.id}`).set("Cookie", cookieA);
    expect(deleteRes.status).toBe(404);
  });

  it("returns 404 for cross-tenant conversation read and reply", async () => {
    const tenantA = await createTenantWithAdmin("Tenant A3");
    const tenantB = await createTenantWithAdmin("Tenant B3");
    const cookieA = await loginAs(tenantA.admin.email);

    const conversationB = await prisma.conversation.create({
      data: { tenantId: tenantB.tenant.id, channel: "WHATSAPP", contactHandle: "+919800000002" },
    });

    const readRes = await request(app).get(`/api/communication/conversations/${conversationB.id}/messages`).set("Cookie", cookieA);
    expect(readRes.status).toBe(404);

    const replyRes = await request(app)
      .post(`/api/communication/conversations/${conversationB.id}/messages`)
      .set("Cookie", cookieA)
      .send({ body: "hijacked" });
    expect(replyRes.status).toBe(404);
  });

  it("never leaks another tenant's rows through a list endpoint", async () => {
    const tenantA = await createTenantWithAdmin("Tenant A4");
    const tenantB = await createTenantWithAdmin("Tenant B4");
    const cookieA = await loginAs(tenantA.admin.email);

    await createTestCustomer(tenantA.tenant.id, { name: "A Customer", phone: "+919800000010" });
    await createTestCustomer(tenantB.tenant.id, { name: "B Customer", phone: "+919800000011" });

    const res = await request(app).get("/api/customers").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("A Customer");
  });

  it("keeps Settings/IntegrationCredential fully isolated per tenant", async () => {
    const tenantA = await createTenantWithAdmin("Tenant A5");
    const tenantB = await createTenantWithAdmin("Tenant B5");
    const cookieA = await loginAs(tenantA.admin.email);
    const cookieB = await loginAs(tenantB.admin.email);

    await request(app)
      .put("/api/settings/integrations/meta")
      .set("Cookie", cookieA)
      .send({ pageId: "page-a", accessToken: "token-a" });

    const statusB = await request(app).get("/api/settings/integrations").set("Cookie", cookieB);
    expect(statusB.body.meta.connected).toBe(false);

    const statusA = await request(app).get("/api/settings/integrations").set("Cookie", cookieA);
    expect(statusA.body.meta.connected).toBe(true);
  });
});
