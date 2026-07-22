import { apiClient } from "./client";
import type { PlanWithFeatures, EffectiveEntitlementRow } from "./superAdminPlans";

export type BillingType = "OneTime" | "Recurring";

export type AddOn = {
  id: string;
  name: string;
  description: string | null;
  priceOneTime: number | null;
  priceRecurring: number | null;
  billingType: BillingType;
  relatedFeatureKey: string | null;
  topUpAmount: number | null;
  isActive: boolean;
};

export type TenantAddOn = {
  id: string;
  addOnId: string;
  addOn: AddOn;
  quantity: number;
  status: "Active" | "Cancelled" | "Expired";
  purchasedAt: string;
  renewsAt: string | null;
};

export type MeteredFeatureKey = "AI_CONTENT_GENERATION" | "WHATSAPP_MESSAGES" | "SCHEDULED_POSTS";

export type UsageStatus = { included: boolean; used: number; limit: number | "unlimited" | null };

export type MyPlan = {
  plan: { id: string; name: string; description: string | null; priceMonthly: number; priceYearly: number; isFeatured: boolean; isActive: boolean } | null;
  subscriptionStatus: "Active" | "PastDue" | "Cancelled" | "Trialing";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  features: EffectiveEntitlementRow[];
  usage: Record<MeteredFeatureKey, UsageStatus>;
};

export async function getMyPlan(): Promise<MyPlan> {
  const { data } = await apiClient.get<MyPlan>("/subscription/plan");
  return data;
}

// Read-only comparison across every active plan — changing plans stays a
// Super Admin action (see routes/superAdminPlans.ts's file comment), so
// this is "what would I get on a different plan", not a checkout.
export async function listComparablePlans(): Promise<PlanWithFeatures[]> {
  const { data } = await apiClient.get<PlanWithFeatures[]>("/subscription/plans");
  return data;
}

// Tenant-facing subscription surface — the add-on catalog + this tenant's
// own add-ons, and the Custom Development request queue.
export async function listAvailableAddOns(): Promise<AddOn[]> {
  const { data } = await apiClient.get<AddOn[]>("/subscription/addons");
  return data;
}

export async function listMyAddOns(): Promise<TenantAddOn[]> {
  const { data } = await apiClient.get<TenantAddOn[]>("/subscription/my-addons");
  return data;
}

export type ServiceType = "UI_CHANGE" | "NEW_MODULE" | "CUSTOM_WORKFLOW" | "API_INTEGRATION" | "SCHEMA_CHANGE" | "CUSTOM_FEATURE" | "ENTERPRISE_CUSTOM";

export type ServiceTypeInfo = { key: ServiceType; label: string; priceRange: string };

export type RequestStatus = "Requested" | "Quoted" | "Approved" | "InProgress" | "Completed" | "Invoiced" | "Cancelled";

export type CustomDevelopmentRequest = {
  id: string;
  tenantId: string;
  serviceType: ServiceType;
  description: string;
  status: RequestStatus;
  quotedAmount: number | null;
  notes: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
};

// Reference price ranges are display-only, shown next to each service type
// so the person filling the form has a rough expectation — never enforced
// against whatever Super Admin later sets as quotedAmount.
export async function listServiceTypes(): Promise<ServiceTypeInfo[]> {
  const { data } = await apiClient.get<ServiceTypeInfo[]>("/subscription/custom-development/service-types");
  return data;
}

export async function listMyCustomDevelopmentRequests(): Promise<CustomDevelopmentRequest[]> {
  const { data } = await apiClient.get<CustomDevelopmentRequest[]>("/subscription/custom-development");
  return data;
}

export async function submitCustomDevelopmentRequest(serviceType: ServiceType, description: string): Promise<CustomDevelopmentRequest> {
  const { data } = await apiClient.post<CustomDevelopmentRequest>("/subscription/custom-development", { serviceType, description });
  return data;
}
