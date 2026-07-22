import { apiClient } from "./client";

export type ValueType = "NUMERIC" | "BOOLEAN" | "TIER" | "TEXT";

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

export async function listPlans(): Promise<PlanWithFeatures[]> {
  const { data } = await apiClient.get<PlanWithFeatures[]>("/super-admin/plans");
  return data;
}

export async function getPlan(planId: string): Promise<PlanWithFeatures> {
  const { data } = await apiClient.get<PlanWithFeatures>(`/super-admin/plans/${planId}`);
  return data;
}

export async function updatePlan(
  planId: string,
  input: { name?: string; description?: string | null; priceMonthly?: number; priceYearly?: number; isFeatured?: boolean; isActive?: boolean }
): Promise<PlanWithFeatures> {
  const { data } = await apiClient.patch<PlanWithFeatures>(`/super-admin/plans/${planId}`, input);
  return data;
}

export async function updatePlanFeature(
  planId: string,
  featureKey: string,
  input: { included: boolean; value: string | null }
): Promise<PlanFeatureRow> {
  const { data } = await apiClient.patch<PlanFeatureRow>(`/super-admin/plans/${planId}/features/${featureKey}`, input);
  return data;
}

// --- Per-tenant plan assignment ------------------------------------------

export async function assignTenantPlan(
  tenantId: string,
  input: { planId: string | null; subscriptionStatus?: "Active" | "PastDue" | "Cancelled" | "Trialing" }
) {
  const { data } = await apiClient.patch(`/super-admin/businesses/${tenantId}/plan`, input);
  return data;
}

// --- Per-tenant feature overrides -----------------------------------------

export type EffectiveEntitlementRow = {
  featureKey: string;
  valueType: ValueType;
  included: boolean;
  value: number | "unlimited" | string | null;
  hasOverride: boolean;
  addOnTopUp: number;
  category: string;
  displayName: string;
  unit: string | null;
  sortOrder: number;
};

export type TenantFeatureOverride = {
  id: string;
  tenantId: string;
  featureKey: string;
  included: boolean | null;
  value: string | null;
  createdAt: string;
  updatedAt: string;
  category: string | null;
  displayName: string;
  valueType: ValueType | null;
  unit: string | null;
};

export async function listTenantOverrides(tenantId: string): Promise<TenantFeatureOverride[]> {
  const { data } = await apiClient.get<TenantFeatureOverride[]>(`/super-admin/businesses/${tenantId}/overrides`);
  return data;
}

export async function listTenantEntitlements(tenantId: string): Promise<EffectiveEntitlementRow[]> {
  const { data } = await apiClient.get<EffectiveEntitlementRow[]>(`/super-admin/businesses/${tenantId}/entitlements`);
  return data;
}

export async function setTenantOverride(
  tenantId: string,
  input: { featureKey: string; included: boolean | null; value: string | null }
): Promise<TenantFeatureOverride> {
  const { data } = await apiClient.post<TenantFeatureOverride>(`/super-admin/businesses/${tenantId}/overrides`, input);
  return data;
}

export async function removeTenantOverride(tenantId: string, featureKey: string): Promise<void> {
  await apiClient.delete(`/super-admin/businesses/${tenantId}/overrides/${featureKey}`);
}
