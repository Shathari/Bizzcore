import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("dashboard summary", () => {
  it("counts today's inquiries, new customers, and shapes a 6-month revenue trend", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    // Customer created "today" via the fixture helper counts toward
    // newCustomersToday automatically (createdAt defaults to now()).
    const customer = await createTestCustomer(tenant.id, { name: "Today Customer", phone: "+919800000050" });
    await prisma.inquiry.create({
      data: { tenantId: tenant.id, customerId: customer.id, source: "WEBSITE", message: "Hi", status: "open" },
    });
    await prisma.purchase.create({
      data: { tenantId: tenant.id, customerId: customer.id, amount: 5000, purchasedAt: new Date() },
    });

    const res = await request(app).get("/api/dashboard/summary").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.todaysInquiries).toBe(1);
    expect(res.body.newCustomersToday).toBe(1);
    expect(res.body.revenueTrend).toHaveLength(6);
    const thisMonthTotal = res.body.revenueTrend[5].revenue;
    expect(thisMonthTotal).toBeGreaterThanOrEqual(5000);
  });

  it("flags VIP/Bridal customers with no recent purchase as priority follow-ups", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await createTestCustomer(tenant.id, {
      name: "Neglected VIP",
      phone: "+919800000051",
      segment: "VIP",
      lastPurchase: null,
    });
    await createTestCustomer(tenant.id, { name: "Regular Shopper", phone: "+919800000052", segment: "Regular" });

    const res = await request(app).get("/api/dashboard/summary").set("Cookie", cookie);
    expect(res.body.pendingFollowUps).toBe(1);
    expect(res.body.priorityFollowUps).toHaveLength(1);
    expect(res.body.priorityFollowUps[0].name).toBe("Neglected VIP");
  });

  it("is tenant-scoped — one tenant's activity never inflates another's summary", async () => {
    const tenantA = await createTenantWithAdmin("Dash A");
    const tenantB = await createTenantWithAdmin("Dash B");
    const cookieA = await loginAs(tenantA.admin.email);

    await createTestCustomer(tenantB.tenant.id, { name: "Other Tenant Customer", phone: "+919800000053" });

    const res = await request(app).get("/api/dashboard/summary").set("Cookie", cookieA);
    expect(res.body.newCustomersToday).toBe(0);
  });
});
