import { prisma } from "./prisma";

// Computes what a tenant ACTUALLY gets for one platform feature key, after
// layering: Plan's PlanFeature -> TenantFeatureOverride (per-tenant bump,
// wins when set) -> active AddOn top-ups (see schema.prisma's Plan/
// PlanFeature/TenantFeatureOverride/AddOn/TenantAddOn comments for the
// full model). This is the single source of truth both the future
// enforceEntitlement middleware and any "what does this tenant have"
// display should call — nothing should re-derive this logic ad hoc.

export type ValueType = "NUMERIC" | "BOOLEAN" | "TIER" | "TEXT";

export type EffectiveEntitlement = {
  featureKey: string;
  valueType: ValueType;
  included: boolean;
  // NUMERIC: total number after add-on top-ups, or "unlimited", or null if
  // not included. TIER/TEXT: the tier/text string, or null. BOOLEAN:
  // always null — `included` alone is the whole answer.
  value: number | "unlimited" | string | null;
  hasOverride: boolean; // true if a TenantFeatureOverride row exists for this key at all
  addOnTopUp: number; // sum of active NUMERIC top-ups actually applied (0 if none/non-numeric)
};

type MinimalOverride = { included: boolean | null; value: string | null } | null | undefined;
type MinimalPlanFeature = { included: boolean; value: string | null } | null | undefined;
type MinimalTenantAddOn = { quantity: number; addOn: { relatedFeatureKey: string | null; isActive: boolean; topUpAmount: number | null } };

// Pure — the actual override/plan/add-on -> effective-value math, with no
// DB access of its own, so both the single-key lookup (getEffectiveEntitlement)
// and the whole-catalog bulk version (getEffectiveEntitlementsForTenant) stay
// byte-for-byte the same logic instead of two hand-synced copies.
function computeEntitlement(
  featureKey: string,
  valueType: ValueType,
  override: MinimalOverride,
  planFeature: MinimalPlanFeature,
  activeAddOns: MinimalTenantAddOn[]
): EffectiveEntitlement {
  // `??` correctly threads a tri-state override (null = "inherit the
  // plan's setting", not "explicitly false"/"explicitly empty") through to
  // the plan's own value.
  let included = override?.included ?? planFeature?.included ?? false;
  const baseValue = override?.value ?? planFeature?.value ?? null;

  let addOnTopUp = 0;
  if (valueType === "NUMERIC") {
    for (const ta of activeAddOns) {
      if (ta.addOn.relatedFeatureKey === featureKey && ta.addOn.isActive && ta.addOn.topUpAmount !== null) {
        addOnTopUp += ta.addOn.topUpAmount * ta.quantity;
      }
    }
    // Not part of the base plan/override at all, but an active add-on
    // still unlocks it — e.g. AI Video Generation is "Add-on" (not
    // included) on Starter; buying it makes the feature usable with the
    // add-on's own top-up as the whole limit.
    if (addOnTopUp > 0 && !included) included = true;
  } else if (!included) {
    // Non-NUMERIC (TIER/TEXT) features have no quantity to sum, but an
    // active add-on tied to this key (e.g. "API Access" -> API_INTEGRATION,
    // "Additional Website" -> WEBSITE_INCLUDED) still grants inclusion —
    // flagged as an inferred behavior in seedAddOns.ts, not spelled out in
    // the original spec for non-NUMERIC features.
    const grantingAddOn = activeAddOns.find((ta) => ta.addOn.relatedFeatureKey === featureKey && ta.addOn.isActive);
    if (grantingAddOn) included = true;
  }

  let value: EffectiveEntitlement["value"] = null;
  if (included) {
    if (valueType === "NUMERIC") {
      value = baseValue === "unlimited" ? "unlimited" : (baseValue !== null && /^\d+$/.test(baseValue) ? Number(baseValue) : 0) + addOnTopUp;
    } else if (valueType !== "BOOLEAN") {
      value = baseValue;
    }
  }

  return { featureKey, valueType, included, value, hasOverride: override != null, addOnTopUp };
}

export async function getEffectiveEntitlement(tenantId: string, featureKey: string): Promise<EffectiveEntitlement> {
  const catalog = await prisma.featureCatalog.findUnique({ where: { featureKey } });
  if (!catalog) {
    throw new Error(`Unknown feature key: ${featureKey} — add it to FeatureCatalog first`);
  }
  const valueType = catalog.valueType as ValueType;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { planId: true } });
  const [override, planFeature, activeAddOns] = await Promise.all([
    prisma.tenantFeatureOverride.findUnique({ where: { tenantId_featureKey: { tenantId, featureKey } } }),
    tenant?.planId
      ? prisma.planFeature.findUnique({ where: { planId_featureKey: { planId: tenant.planId, featureKey } } })
      : Promise.resolve(null),
    prisma.tenantAddOn.findMany({
      where: { tenantId, status: "Active", addOn: { relatedFeatureKey: featureKey, isActive: true } },
      include: { addOn: true },
    }),
  ]);

  return computeEntitlement(featureKey, valueType, override, planFeature, activeAddOns);
}

export type EffectiveEntitlementRow = EffectiveEntitlement & {
  category: string;
  displayName: string;
  unit: string | null;
  sortOrder: number;
};

// Bulk version for a full "your plan" display (tenant Subscription page,
// Super Admin's per-tenant override panel) — one batch of queries instead
// of N calls to getEffectiveEntitlement, one per FeatureCatalog row.
export async function getEffectiveEntitlementsForTenant(tenantId: string): Promise<EffectiveEntitlementRow[]> {
  const [catalog, tenant, overrides, activeAddOns] = await Promise.all([
    prisma.featureCatalog.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { planId: true } }),
    prisma.tenantFeatureOverride.findMany({ where: { tenantId } }),
    prisma.tenantAddOn.findMany({ where: { tenantId, status: "Active" }, include: { addOn: true } }),
  ]);
  const planFeatures = tenant?.planId ? await prisma.planFeature.findMany({ where: { planId: tenant.planId } }) : [];
  const planByKey = new Map(planFeatures.map((f) => [f.featureKey, f]));
  const overrideByKey = new Map(overrides.map((o) => [o.featureKey, o]));

  return catalog.map((c) => {
    const valueType = c.valueType as ValueType;
    const entitlement = computeEntitlement(c.featureKey, valueType, overrideByKey.get(c.featureKey), planByKey.get(c.featureKey), activeAddOns);
    return { ...entitlement, category: c.category, displayName: c.displayName, unit: c.unit, sortOrder: c.sortOrder };
  });
}

// ---------------------------------------------------------------------------
// Enforcement — three separate shapes, because the catalog's NUMERIC
// features are not all the same kind of limit:
//   1. Monthly consumption ("/mo" unit — AI_CONTENT_GENERATION,
//      WHATSAPP_MESSAGES, SCHEDULED_POSTS): tracked via UsageCounter,
//      resets every calendar month.
//   2. Standing item caps ("items"/"accounts"/"GB" unit — CMS_PRODUCTS
//      etc.): not consumption at all, just "how many do you have right
//      now" — counted live against the rows they cap, no counter table.
//   3. Plain inclusion gates (BOOLEAN/TIER features — IMPORT_EXPORT etc.):
//      no quantity, just whether the plan includes it.
// ---------------------------------------------------------------------------

function periodStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export type UsageCheck =
  | { allowed: true; used: number; limit: number | "unlimited" }
  | { allowed: false; reason: "not_included"; used: 0; limit: null }
  | { allowed: false; reason: "limit_reached"; used: number; limit: number };

// Read-only — does not increment. Callers that only need to gate a request
// (without a matching "this succeeded, spend a unit" moment, e.g. a per-
// recipient broadcast loop) call this directly instead of
// checkAndIncrementUsage.
export async function checkUsageLimit(tenantId: string, featureKey: string, amount = 1): Promise<UsageCheck> {
  const entitlement = await getEffectiveEntitlement(tenantId, featureKey);
  if (entitlement.valueType !== "NUMERIC") {
    throw new Error(`checkUsageLimit is only for NUMERIC features; ${featureKey} is ${entitlement.valueType}`);
  }
  if (!entitlement.included) {
    return { allowed: false, reason: "not_included", used: 0, limit: null };
  }
  if (entitlement.value === "unlimited") {
    return { allowed: true, used: 0, limit: "unlimited" };
  }

  const periodStart = periodStartOf(new Date());
  const existing = await prisma.usageCounter.findUnique({
    where: { tenantId_featureKey_periodStart: { tenantId, featureKey, periodStart } },
  });
  const used = existing?.count ?? 0;
  const limit = entitlement.value as number;
  if (used + amount > limit) {
    return { allowed: false, reason: "limit_reached", used, limit };
  }
  return { allowed: true, used, limit };
}

// Assumes checkUsageLimit already passed — no re-check, just records
// consumption. Kept separate from the check so AI generation (and anything
// else that can fail after the check) only spends a unit on real success.
export async function incrementUsage(tenantId: string, featureKey: string, amount = 1): Promise<void> {
  const periodStart = periodStartOf(new Date());
  await prisma.usageCounter.upsert({
    where: { tenantId_featureKey_periodStart: { tenantId, featureKey, periodStart } },
    update: { count: { increment: amount } },
    create: { tenantId, featureKey, periodStart, count: amount },
  });
}

// Convenience for the common case (check + spend together, no
// success-dependent step in between) — message sends, item creates.
export async function checkAndIncrementUsage(tenantId: string, featureKey: string, amount = 1): Promise<UsageCheck> {
  const result = await checkUsageLimit(tenantId, featureKey, amount);
  if (result.allowed) await incrementUsage(tenantId, featureKey, amount);
  return result;
}

export type ItemCountCheck =
  | { allowed: true; used: number; limit: number | "unlimited" }
  | { allowed: false; reason: "not_included"; used: 0; limit: null }
  | { allowed: false; reason: "limit_reached"; used: number; limit: number };

// For standing item caps: `currentCount` is supplied by the caller (a live
// COUNT of the rows this feature caps), not tracked separately here.
export async function checkItemCountCap(tenantId: string, featureKey: string, currentCount: number): Promise<ItemCountCheck> {
  const entitlement = await getEffectiveEntitlement(tenantId, featureKey);
  if (entitlement.valueType !== "NUMERIC") {
    throw new Error(`checkItemCountCap is only for NUMERIC features; ${featureKey} is ${entitlement.valueType}`);
  }
  if (!entitlement.included) {
    return { allowed: false, reason: "not_included", used: 0, limit: null };
  }
  if (entitlement.value === "unlimited") {
    return { allowed: true, used: currentCount, limit: "unlimited" };
  }
  const limit = entitlement.value as number;
  if (currentCount + 1 > limit) {
    return { allowed: false, reason: "limit_reached", used: currentCount, limit };
  }
  return { allowed: true, used: currentCount, limit };
}

// For BOOLEAN/TIER inclusion gates — no quantity, just "does the plan
// include this at all".
export async function requireFeatureIncluded(tenantId: string, featureKey: string): Promise<boolean> {
  const entitlement = await getEffectiveEntitlement(tenantId, featureKey);
  return entitlement.included;
}
