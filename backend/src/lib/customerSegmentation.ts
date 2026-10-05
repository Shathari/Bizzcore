import { prisma } from "./prisma";

// --- Recency / value (Step 3) ---------------------------------------------
//
// Deliberately NOT stored columns: value is already Customer.totalSpent
// (always current, nothing to recompute), and recency ("days since last
// purchase") goes stale the day after it's computed regardless of whether
// anything else changed — a stored number would need this exact same daily
// job to stay correct anyway, so computing it on read is strictly more
// correct than materializing it. Frequency ("purchase count in a window")
// has no real source yet: Customer only has a running totalSpent and a
// single lastPurchase date, neither of which can reconstruct a COUNT of
// purchases. The purchase-entry API now derives recorded purchase count
// from Purchase; older imported totals still cannot reconstruct historical
// frequency. The existing recency/inactivity calculations continue using
// lastPurchase, which sale recording updates transactionally.
export function daysSinceLastPurchase(customer: { lastPurchase: Date | null }): number | null {
  if (!customer.lastPurchase) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - customer.lastPurchase.getTime()) / msPerDay);
}

// --- Inactive-customer auto-categorization (Step 3) ------------------------
//
// The one and only tag name this job ever manages — a fixed name, not
// tenant-configurable (tenant-configurable is the THRESHOLD, via
// Tenant.inactivityThresholdDays; the tag's own name is not, to keep this
// job's identity stable regardless of what a tenant renames their custom
// tags to). If a tenant separately creates/applies their own tag that
// happens to share this name, source: STAFF on that assignment (see below)
// keeps this job from ever touching it.
const INACTIVE_TAG_NAME = "Inactive";

// Exported for direct unit testing and for a future manual "recompute now"
// trigger — jobs/scheduler.ts's cron call is the only thing that runs this
// unprompted in production.
export async function recomputeInactiveCustomers(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, inactivityThresholdDays: true },
  });
  for (const tenant of tenants) {
    await recomputeInactiveCustomersForTenant(tenant.id, tenant.inactivityThresholdDays);
  }
}

// Per-tenant so a single slow/failing tenant can't block every other
// tenant's recompute in the same run (jobs/scheduler.ts can choose to run
// these independently rather than only through the bulk function above).
export async function recomputeInactiveCustomersForTenant(tenantId: string, thresholdDays: number): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);

  const tag = await prisma.customerTag.upsert({
    where: { tenantId_name: { tenantId, name: INACTIVE_TAG_NAME } },
    update: {},
    create: { tenantId, name: INACTIVE_TAG_NAME },
  });

  // Inactive = last purchase older than the threshold, OR never purchased
  // AND the account itself predates the threshold — a brand-new customer
  // with no purchase yet is "new," not "inactive."
  const inactiveCustomers = await prisma.customer.findMany({
    where: {
      tenantId,
      OR: [{ lastPurchase: { lt: cutoff } }, { lastPurchase: null, createdAt: { lt: cutoff } }],
    },
    select: { id: true },
  });
  const inactiveIds = inactiveCustomers.map((c) => c.id);

  // Filtered by hand rather than createMany's skipDuplicates — SQLite (used
  // in tests; see schema.prisma's header comment on Postgres/SQLite parity)
  // doesn't support that option at all, so this has to work without it.
  // Skipping customers who already carry this tag (whether a prior SYSTEM
  // run or a staff member's own manual tagging of the same name) matters
  // for the same reason skipDuplicates would have: never overwrite an
  // existing row's `source`, and never error on the
  // @@unique([customerId, tagId]) constraint.
  const alreadyAssigned = await prisma.customerTagAssignment.findMany({
    where: { tenantId, tagId: tag.id },
    select: { customerId: true },
  });
  const alreadyAssignedIds = new Set(alreadyAssigned.map((a) => a.customerId));
  const toCreate = inactiveIds.filter((id) => !alreadyAssignedIds.has(id));

  if (toCreate.length > 0) {
    await prisma.customerTagAssignment.createMany({
      data: toCreate.map((customerId) => ({ tenantId, customerId, tagId: tag.id, source: "SYSTEM" as const })),
    });
  }

  // Un-tag customers who no longer meet the inactivity criteria — but only
  // the assignments THIS job created (source: SYSTEM). A staff member who
  // manually applied the same-named tag for their own reason keeps it
  // regardless of what this job currently thinks about that customer's
  // activity; the @@unique constraint means there's only ever one
  // assignment row per (customer, tag), so `source` is the only way to
  // tell "the job did this" apart from "a person did this" at removal time.
  await prisma.customerTagAssignment.deleteMany({
    where: {
      tenantId,
      tagId: tag.id,
      source: "SYSTEM",
      ...(inactiveIds.length > 0 ? { customerId: { notIn: inactiveIds } } : {}),
    },
  });
}
