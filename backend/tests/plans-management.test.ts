import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("Super Admin Plans management", () => {
  it("blocks a regular ADMIN from every plans-management route with 403", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });

    const calls = [
      request(app).get("/api/super-admin/plans").set("Cookie", cookie),
      request(app).get(`/api/super-admin/plans/${plan.id}`).set("Cookie", cookie),
      request(app).patch(`/api/super-admin/plans/${plan.id}`).set("Cookie", cookie).send({ priceMonthly: 1 }),
      request(app).patch(`/api/super-admin/plans/${plan.id}/features/AI_CONTENT_GENERATION`).set("Cookie", cookie).send({ included: true, value: "5" }),
      request(app).patch(`/api/super-admin/businesses/${tenant.id}/plan`).set("Cookie", cookie).send({ planId: plan.id }),
      request(app).get(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie),
      request(app).post(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie).send({ featureKey: "AI_CONTENT_GENERATION", included: true, value: "5" }),
    ];
    const results = await Promise.all(calls);
    for (const res of results) expect(res.status).toBe(403);
  });

  it("lists all plans with their full feature grid", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    const res = await request(app).get("/api/super-admin/plans").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const starter = res.body.find((p: { name: string }) => p.name === "Starter AI");
    expect(starter.features.length).toBeGreaterThan(50);
    const aiRow = starter.features.find((f: { featureKey: string }) => f.featureKey === "AI_CONTENT_GENERATION");
    expect(aiRow).toMatchObject({ included: true, value: "100", category: "AI_MARKETING" });
  });

  it("gets one plan's detail by id", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } });

    const res = await request(app).get(`/api/super-admin/plans/${plan.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Enterprise / Business OS");
    const aiRow = res.body.features.find((f: { featureKey: string }) => f.featureKey === "AI_CONTENT_GENERATION");
    expect(aiRow.value).toBe("unlimited");
  });

  it("404s for an unknown plan id", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const res = await request(app).get("/api/super-admin/plans/not-a-real-id").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("updates a plan's price/featured/active, and it's audited", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });

    const res = await request(app)
      .patch(`/api/super-admin/plans/${plan.id}`)
      .set("Cookie", cookie)
      .send({ priceMonthly: 1099, isFeatured: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ priceMonthly: 1099, isFeatured: true });

    const auditRows = await prisma.auditLog.findMany({ where: { action: "PLAN_UPDATED" } });
    expect(auditRows.length).toBeGreaterThan(0);

    // Restore, so this test doesn't leak state into other tests in this file.
    await prisma.plan.update({ where: { id: plan.id }, data: { priceMonthly: 999, isFeatured: false } });
  });

  it("edits one feature cell of a plan's grid — this is what actually changes what the plan includes", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } }); // BLOG_GENERATION = not included (❌)

    const res = await request(app)
      .patch(`/api/super-admin/plans/${plan.id}/features/BLOG_GENERATION`)
      .set("Cookie", cookie)
      .send({ included: true, value: "10" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ included: true, value: "10" });

    // A tenant on this plan immediately sees the new value — no separate sync step.
    const { tenant, admin } = await createTenantWithAdmin();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const tenantCookie = await loginAs(admin.email);
    const planRes = await request(app).get("/api/subscription/plan").set("Cookie", tenantCookie);
    const blogRow = planRes.body.features.find((f: { featureKey: string }) => f.featureKey === "BLOG_GENERATION");
    expect(blogRow).toMatchObject({ included: true, value: 10 });

    // Restore.
    await prisma.planFeature.update({ where: { planId_featureKey: { planId: plan.id, featureKey: "BLOG_GENERATION" } }, data: { included: false, value: null } });
  });

  it("rejects editing a feature key that isn't in the catalog", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });

    const res = await request(app)
      .patch(`/api/super-admin/plans/${plan.id}/features/NOT_A_REAL_FEATURE`)
      .set("Cookie", cookie)
      .send({ included: true, value: "10" });
    expect(res.status).toBe(404);
  });
});

describe("Super Admin: per-tenant plan assignment", () => {
  it("assigns a plan to a tenant, starting a fresh period, and it's audited", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Business Growth" } });

    const res = await request(app).patch(`/api/super-admin/businesses/${tenant.id}/plan`).set("Cookie", cookie).send({ planId: plan.id });
    expect(res.status).toBe(200);
    expect(res.body.planId).toBe(plan.id);
    expect(res.body.subscriptionStatus).toBe("Active");
    expect(res.body.currentPeriodStart).not.toBeNull();
    expect(res.body.currentPeriodEnd).not.toBeNull();

    const auditRows = await prisma.auditLog.findMany({ where: { targetTenantId: tenant.id, action: "TENANT_PLAN_CHANGED" } });
    expect(auditRows).toHaveLength(1);

    const tenantCookie = await loginAs(admin.email);
    const planRes = await request(app).get("/api/subscription/plan").set("Cookie", tenantCookie);
    expect(planRes.body.plan.name).toBe("Business Growth");
  });

  it("unassigns a plan by sending planId: null", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    const res = await request(app).patch(`/api/super-admin/businesses/${tenant.id}/plan`).set("Cookie", cookie).send({ planId: null });
    expect(res.status).toBe(200);
    expect(res.body.planId).toBeNull();
  });

  it("rejects assigning an unknown plan id", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    const res = await request(app).patch(`/api/super-admin/businesses/${tenant.id}/plan`).set("Cookie", cookie).send({ planId: "not-a-real-plan" });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown tenant", async () => {
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const res = await request(app).patch("/api/super-admin/businesses/not-a-real-tenant/plan").set("Cookie", cookie).send({ planId: null });
    expect(res.status).toBe(404);
  });
});

describe("Super Admin: per-tenant feature overrides", () => {
  it("creates an override, lists it with catalog metadata, and it wins over the plan's own value", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } }); // AI_CONTENT_GENERATION = 100
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    const createRes = await request(app)
      .post(`/api/super-admin/businesses/${tenant.id}/overrides`)
      .set("Cookie", cookie)
      .send({ featureKey: "AI_CONTENT_GENERATION", included: true, value: "9999" });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({ featureKey: "AI_CONTENT_GENERATION", value: "9999", category: "AI_MARKETING", displayName: "AI Content Generation" });

    const auditRows = await prisma.auditLog.findMany({ where: { targetTenantId: tenant.id, action: "TENANT_OVERRIDE_SET" } });
    expect(auditRows).toHaveLength(1);

    const tenantCookie = await loginAs(admin.email);
    const planRes = await request(app).get("/api/subscription/plan").set("Cookie", tenantCookie);
    const aiRow = planRes.body.features.find((f: { featureKey: string }) => f.featureKey === "AI_CONTENT_GENERATION");
    expect(aiRow).toMatchObject({ included: true, value: 9999, hasOverride: true });
  });

  it("upserts on a second POST for the same feature key, rather than duplicating", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    await request(app).post(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie).send({ featureKey: "SMS", included: true, value: "50" });
    await request(app).post(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie).send({ featureKey: "SMS", included: true, value: "500" });

    const listRes = await request(app).get(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].value).toBe("500");
  });

  it("removes an override, falling back to the plan's own value", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    await request(app).post(`/api/super-admin/businesses/${tenant.id}/overrides`).set("Cookie", cookie).send({ featureKey: "AI_CONTENT_GENERATION", included: true, value: "9999" });
    const deleteRes = await request(app).delete(`/api/super-admin/businesses/${tenant.id}/overrides/AI_CONTENT_GENERATION`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const auditRows = await prisma.auditLog.findMany({ where: { targetTenantId: tenant.id, action: "TENANT_OVERRIDE_REMOVED" } });
    expect(auditRows).toHaveLength(1);

    const tenantCookie = await loginAs(admin.email);
    const planRes = await request(app).get("/api/subscription/plan").set("Cookie", tenantCookie);
    const aiRow = planRes.body.features.find((f: { featureKey: string }) => f.featureKey === "AI_CONTENT_GENERATION");
    expect(aiRow).toMatchObject({ included: true, value: 100, hasOverride: false }); // back to Starter AI's own 100
  });

  it("404s deleting an override that doesn't exist", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const res = await request(app).delete(`/api/super-admin/businesses/${tenant.id}/overrides/AI_CONTENT_GENERATION`).set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("rejects an override for a feature key that isn't in the catalog", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);
    const res = await request(app)
      .post(`/api/super-admin/businesses/${tenant.id}/overrides`)
      .set("Cookie", cookie)
      .send({ featureKey: "NOT_A_REAL_FEATURE", included: true, value: "1" });
    expect(res.status).toBe(400);
  });

  it("exposes the full effective entitlement grid for Super Admin via /entitlements", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const { user: superAdmin } = await createSuperAdmin();
    const cookie = await loginAs(superAdmin.email);

    const res = await request(app).get(`/api/super-admin/businesses/${tenant.id}/entitlements`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(50);
    const aiRow = res.body.find((f: { featureKey: string }) => f.featureKey === "AI_CONTENT_GENERATION");
    expect(aiRow).toMatchObject({ included: true, value: "unlimited" }); // Enterprise
  });
});

describe("tenant-facing plan detail and comparison", () => {
  it("returns the tenant's own plan, status, period, effective feature grid, and metered usage", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id, subscriptionStatus: "Active" } });
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/subscription/plan").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.plan.name).toBe("Starter AI");
    expect(res.body.subscriptionStatus).toBe("Active");
    expect(res.body.features.length).toBeGreaterThan(50);
    expect(res.body.usage).toMatchObject({
      AI_CONTENT_GENERATION: { included: true, used: 0, limit: 100 },
      WHATSAPP_MESSAGES: { included: true, used: 0, limit: 200 },
      SCHEDULED_POSTS: { included: true, used: 0, limit: 100 },
    });
  });

  it("returns plan: null and not_included usage for a tenant with no plan at all", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/subscription/plan").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBeNull();
    expect(res.body.usage.AI_CONTENT_GENERATION).toMatchObject({ included: false });
  });

  it("lists every active plan with its full feature grid, for comparison — no tenant-specific data", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/subscription/plans").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.every((p: { isActive: boolean }) => p.isActive)).toBe(true);
  });

  it("excludes an inactive plan from the tenant comparison view but keeps it visible to Super Admin", async () => {
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } });
    await prisma.plan.update({ where: { id: plan.id }, data: { isActive: false } });

    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const tenantRes = await request(app).get("/api/subscription/plans").set("Cookie", cookie);
    expect(tenantRes.body.some((p: { name: string }) => p.name === "Enterprise / Business OS")).toBe(false);

    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);
    const superRes = await request(app).get("/api/super-admin/plans").set("Cookie", superCookie);
    expect(superRes.body.some((p: { name: string }) => p.name === "Enterprise / Business OS")).toBe(true);

    // Restore.
    await prisma.plan.update({ where: { id: plan.id }, data: { isActive: true } });
  });
});
