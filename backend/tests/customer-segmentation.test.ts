import { describe, it, expect } from "vitest";
import { recomputeInactiveCustomersForTenant, daysSinceLastPurchase } from "../src/lib/customerSegmentation";
import { createTenantWithAdmin, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";

const THRESHOLD_DAYS = 90;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function inactiveTagCustomerIds(tenantId: string): Promise<string[]> {
  const tag = await prisma.customerTag.findUnique({ where: { tenantId_name: { tenantId, name: "Inactive" } } });
  if (!tag) return [];
  const assignments = await prisma.customerTagAssignment.findMany({ where: { tenantId, tagId: tag.id } });
  return assignments.map((a) => a.customerId);
}

describe("lib/customerSegmentation.ts", () => {
  it("daysSinceLastPurchase: null for never purchased, a real day count otherwise", () => {
    expect(daysSinceLastPurchase({ lastPurchase: null })).toBeNull();
    expect(daysSinceLastPurchase({ lastPurchase: daysAgo(10) })).toBe(10);
  });

  it("tags a customer inactive when lastPurchase is older than the threshold, leaves a recent one alone", async () => {
    const { tenant } = await createTenantWithAdmin();
    const stale = await createTestCustomer(tenant.id, { name: "Stale", lastPurchase: daysAgo(100) });
    const recent = await createTestCustomer(tenant.id, { name: "Recent", lastPurchase: daysAgo(5) });

    await recomputeInactiveCustomersForTenant(tenant.id, THRESHOLD_DAYS);

    const tagged = await inactiveTagCustomerIds(tenant.id);
    expect(tagged).toEqual([stale.id]);
    expect(tagged).not.toContain(recent.id);
  });

  it("tags a never-purchased customer whose account itself predates the threshold, not a brand-new one", async () => {
    const { tenant } = await createTenantWithAdmin();
    const oldNeverPurchased = await createTestCustomer(tenant.id, { name: "Old", lastPurchase: null, createdAt: daysAgo(120) });
    const brandNew = await createTestCustomer(tenant.id, { name: "New", lastPurchase: null });

    await recomputeInactiveCustomersForTenant(tenant.id, THRESHOLD_DAYS);

    const tagged = await inactiveTagCustomerIds(tenant.id);
    expect(tagged).toEqual([oldNeverPurchased.id]);
    expect(tagged).not.toContain(brandNew.id);
  });

  it("removes the SYSTEM tag once a customer becomes active again, but never touches a STAFF-applied one with the same name", async () => {
    const { tenant } = await createTenantWithAdmin();
    const customer = await createTestCustomer(tenant.id, { name: "Comeback", lastPurchase: daysAgo(100) });
    const staffTaggedCustomer = await createTestCustomer(tenant.id, { name: "ManuallyFlagged", lastPurchase: daysAgo(1) });

    // First pass: both should not be tagged yet for staffTaggedCustomer — apply a manual "Inactive" tag by hand.
    await recomputeInactiveCustomersForTenant(tenant.id, THRESHOLD_DAYS);
    let tagged = await inactiveTagCustomerIds(tenant.id);
    expect(tagged).toEqual([customer.id]);

    const tag = await prisma.customerTag.findUniqueOrThrow({ where: { tenantId_name: { tenantId: tenant.id, name: "Inactive" } } });
    await prisma.customerTagAssignment.create({
      data: { tenantId: tenant.id, customerId: staffTaggedCustomer.id, tagId: tag.id, source: "STAFF" },
    });

    // Customer becomes active again.
    await prisma.customer.update({ where: { id: customer.id }, data: { lastPurchase: new Date() } });

    await recomputeInactiveCustomersForTenant(tenant.id, THRESHOLD_DAYS);
    tagged = await inactiveTagCustomerIds(tenant.id);

    // The SYSTEM tag on the now-active customer is gone...
    expect(tagged).not.toContain(customer.id);
    // ...but the staff's own manual tagging of an otherwise-active customer survives.
    expect(tagged).toContain(staffTaggedCustomer.id);
    const survivingAssignment = await prisma.customerTagAssignment.findUniqueOrThrow({
      where: { customerId_tagId: { customerId: staffTaggedCustomer.id, tagId: tag.id } },
    });
    expect(survivingAssignment.source).toBe("STAFF");
  });

  it("is tenant-scoped — one tenant's threshold and customers never affect another's", async () => {
    const tenantA = await createTenantWithAdmin("Seg A");
    const tenantB = await createTenantWithAdmin("Seg B");
    const staleA = await createTestCustomer(tenantA.tenant.id, { name: "Stale A", lastPurchase: daysAgo(100) });
    const staleB = await createTestCustomer(tenantB.tenant.id, { name: "Stale B", lastPurchase: daysAgo(100) });

    await recomputeInactiveCustomersForTenant(tenantA.tenant.id, THRESHOLD_DAYS);

    expect(await inactiveTagCustomerIds(tenantA.tenant.id)).toEqual([staleA.id]);
    expect(await inactiveTagCustomerIds(tenantB.tenant.id)).toEqual([]);
    // staleB's own row is untouched, just not yet recomputed for its tenant.
    const stillThere = await prisma.customer.findUnique({ where: { id: staleB.id } });
    expect(stillThere).not.toBeNull();
  });
});
