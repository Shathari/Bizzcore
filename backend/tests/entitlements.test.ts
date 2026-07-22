import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getEffectiveEntitlement } from "../src/lib/entitlements";
import { createTenantWithAdmin } from "./helpers";

// Unit coverage for the plan -> override -> add-on layering described in
// schema.prisma's Plan/PlanFeature/TenantFeatureOverride/AddOn comments.
describe("getEffectiveEntitlement", () => {
  it("returns the plan's own value with no override or add-ons", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Business Growth" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });

    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: true, value: 2000, addOnTopUp: 0, hasOverride: false });
  });

  it("returns included: false, value: null for a tenant with no plan at all", async () => {
    const { tenant } = await createTenantWithAdmin();
    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: false, value: null });
  });

  it("a TenantFeatureOverride's value wins over the plan's own value", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    await prisma.tenantFeatureOverride.create({
      data: { tenantId: tenant.id, featureKey: "AI_CONTENT_GENERATION", value: "9999" },
    });

    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: true, value: 9999, hasOverride: true });
  });

  it("sums active add-on top-ups on top of the plan's base NUMERIC value", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } }); // AI_CONTENT_GENERATION = 100
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Extra AI Generations (1,000)" } });
    await prisma.tenantAddOn.create({ data: { tenantId: tenant.id, addOnId: addOn.id, quantity: 2, status: "Active" } });

    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: true, value: 100 + 1000 * 2, addOnTopUp: 2000 });
  });

  it("ignores a Cancelled add-on's top-up", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Extra AI Generations (1,000)" } });
    await prisma.tenantAddOn.create({ data: { tenantId: tenant.id, addOnId: addOn.id, quantity: 1, status: "Cancelled" } });

    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: true, value: 100, addOnTopUp: 0 });
  });

  it("an add-on unlocks a NUMERIC feature the plan doesn't include at all (AI Video Generation on Starter)", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } }); // AI_VIDEO_GENERATION = Add-on-only (not included)
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });

    const before = await getEffectiveEntitlement(tenant.id, "AI_VIDEO_GENERATION");
    expect(before).toMatchObject({ included: false, value: null });

    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "AI Video Generation (100 videos)" } });
    await prisma.tenantAddOn.create({ data: { tenantId: tenant.id, addOnId: addOn.id, quantity: 1, status: "Active" } });

    const after = await getEffectiveEntitlement(tenant.id, "AI_VIDEO_GENERATION");
    expect(after).toMatchObject({ included: true, value: 100, addOnTopUp: 100 });
  });

  it("a TIER-related add-on (API Access) grants inclusion without a numeric top-up", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Starter AI" } }); // API_INTEGRATION not included
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });

    const before = await getEffectiveEntitlement(tenant.id, "API_INTEGRATION");
    expect(before.included).toBe(false);

    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "API Access" } });
    await prisma.tenantAddOn.create({ data: { tenantId: tenant.id, addOnId: addOn.id, quantity: 1, status: "Active" } });

    const after = await getEffectiveEntitlement(tenant.id, "API_INTEGRATION");
    expect(after.included).toBe(true);
  });

  it("unlimited plan values stay \"unlimited\" regardless of add-ons", async () => {
    const { tenant } = await createTenantWithAdmin();
    const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } }); // AI_CONTENT_GENERATION = unlimited
    await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });

    const result = await getEffectiveEntitlement(tenant.id, "AI_CONTENT_GENERATION");
    expect(result).toMatchObject({ included: true, value: "unlimited" });
  });

  it("throws for an unregistered feature key", async () => {
    const { tenant } = await createTenantWithAdmin();
    await expect(getEffectiveEntitlement(tenant.id, "NOT_A_REAL_KEY")).rejects.toThrow();
  });
});
