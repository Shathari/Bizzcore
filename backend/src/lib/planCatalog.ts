import { prisma } from "./prisma";
import type { ValueType } from "./entitlements";

// Read-side helper shared by Super Admin's Plans management page (all
// plans, including inactive) and the tenant Subscription page's
// plan-comparison view (active plans only) — same shape either way, one
// row per FeatureCatalog entry with that plan's own included/value (not a
// tenant's effective value — no overrides/add-ons here, see
// getEffectiveEntitlementsForTenant in lib/entitlements.ts for that).

export type PlanFeatureRow = {
  featureKey: string;
  category: string;
  displayName: string;
  valueType: ValueType;
  unit: string | null;
  sortOrder: number;
  included: boolean;
  value: string | null;
};

export type PlanWithFeatures = {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  isFeatured: boolean;
  isActive: boolean;
  features: PlanFeatureRow[];
};

export async function listPlansWithFeatures(opts: { activeOnly?: boolean } = {}): Promise<PlanWithFeatures[]> {
  const [catalog, plans] = await Promise.all([
    prisma.featureCatalog.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.plan.findMany({
      where: opts.activeOnly ? { isActive: true } : undefined,
      include: { features: true },
      orderBy: { priceMonthly: "asc" },
    }),
  ]);

  return plans.map((plan) => {
    const byKey = new Map(plan.features.map((f) => [f.featureKey, f]));
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      isFeatured: plan.isFeatured,
      isActive: plan.isActive,
      features: catalog.map((c) => {
        const pf = byKey.get(c.featureKey);
        return {
          featureKey: c.featureKey,
          category: c.category,
          displayName: c.displayName,
          valueType: c.valueType as ValueType,
          unit: c.unit,
          sortOrder: c.sortOrder,
          included: pf?.included ?? false,
          value: pf?.value ?? null,
        };
      }),
    };
  });
}

export async function getPlanWithFeatures(planId: string): Promise<PlanWithFeatures | null> {
  const [catalog, plan] = await Promise.all([
    prisma.featureCatalog.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.plan.findUnique({ where: { id: planId }, include: { features: true } }),
  ]);
  if (!plan) return null;

  const byKey = new Map(plan.features.map((f) => [f.featureKey, f]));
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    isFeatured: plan.isFeatured,
    isActive: plan.isActive,
    features: catalog.map((c) => {
      const pf = byKey.get(c.featureKey);
      return {
        featureKey: c.featureKey,
        category: c.category,
        displayName: c.displayName,
        valueType: c.valueType as ValueType,
        unit: c.unit,
        sortOrder: c.sortOrder,
        included: pf?.included ?? false,
        value: pf?.value ?? null,
      };
    }),
  };
}
