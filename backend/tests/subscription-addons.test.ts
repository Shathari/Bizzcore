import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("subscription add-ons", () => {
  it("blocks a regular ADMIN from granting an add-on with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Custom Domain Setup" } });

    const res = await request(app)
      .post(`/api/super-admin/businesses/${tenant.id}/addons`)
      .set("Cookie", cookie)
      .send({ addOnId: addOn.id, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it("Super Admin grants an add-on — no real payment, just a TenantAddOn record — and it appears in the tenant's own list", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const tenantCookie = await loginAs(admin.email);
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Additional Team Member" } });

    const grantRes = await request(app)
      .post(`/api/super-admin/businesses/${tenant.id}/addons`)
      .set("Cookie", superCookie)
      .send({ addOnId: addOn.id, quantity: 3 });
    expect(grantRes.status).toBe(201);
    expect(grantRes.body.status).toBe("Active");
    expect(grantRes.body.quantity).toBe(3);
    expect(grantRes.body.renewsAt).not.toBeNull(); // Recurring add-on

    // Audited, without a real payment gateway involved.
    const auditRows = await prisma.auditLog.findMany({ where: { targetTenantId: tenant.id, action: "ADDON_GRANTED" } });
    expect(auditRows).toHaveLength(1);

    const myAddOns = await request(app).get("/api/subscription/my-addons").set("Cookie", tenantCookie);
    expect(myAddOns.status).toBe(200);
    expect(myAddOns.body).toHaveLength(1);
    expect(myAddOns.body[0].addOn.name).toBe("Additional Team Member");
    expect(myAddOns.body[0].quantity).toBe(3);
  });

  it("Super Admin can cancel a granted add-on, and it stops counting toward the effective entitlement", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Extra AI Generations (1,000)" } });

    const grantRes = await request(app)
      .post(`/api/super-admin/businesses/${tenant.id}/addons`)
      .set("Cookie", superCookie)
      .send({ addOnId: addOn.id, quantity: 1 });
    expect(grantRes.status).toBe(201);

    const cancelRes = await request(app)
      .patch(`/api/super-admin/businesses/${tenant.id}/addons/${grantRes.body.id}`)
      .set("Cookie", superCookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("Cancelled");

    const { getEffectiveEntitlement } = await import("../src/lib/entitlements");
    const entitlement = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(entitlement.addOnTopUp).toBe(0); // cancelled add-on no longer applies
  });

  it("tenant-facing catalog and grant list are correctly tenant-scoped", async () => {
    const tenantA = await createTenantWithAdmin("Addon A");
    const tenantB = await createTenantWithAdmin("Addon B");
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const cookieA = await loginAs(tenantA.admin.email);
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Premium Template" } });

    await request(app)
      .post(`/api/super-admin/businesses/${tenantB.tenant.id}/addons`)
      .set("Cookie", superCookie)
      .send({ addOnId: addOn.id, quantity: 1 });

    const myAddOnsA = await request(app).get("/api/subscription/my-addons").set("Cookie", cookieA);
    expect(myAddOnsA.body).toHaveLength(0); // tenant A sees none of tenant B's grants

    const catalog = await request(app).get("/api/subscription/addons").set("Cookie", cookieA);
    expect(catalog.status).toBe(200);
    expect(catalog.body.length).toBeGreaterThan(0); // catalog itself is shared, not tenant-scoped
  });
});
