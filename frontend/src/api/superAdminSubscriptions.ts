import { apiClient } from "./client";

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

export type TenantAddOnStatus = "Active" | "Cancelled" | "Expired";

export type TenantAddOn = {
  id: string;
  tenantId: string;
  addOnId: string;
  addOn: AddOn;
  quantity: number;
  status: TenantAddOnStatus;
  purchasedAt: string;
  renewsAt: string | null;
};

export async function listAddOnCatalog(): Promise<AddOn[]> {
  const { data } = await apiClient.get<AddOn[]>("/super-admin/addons");
  return data;
}

export async function listTenantAddOns(tenantId: string): Promise<TenantAddOn[]> {
  const { data } = await apiClient.get<TenantAddOn[]>(`/super-admin/businesses/${tenantId}/addons`);
  return data;
}

// No real payment — records the grant directly, same mocked-billing
// pattern as the rest of subscriptions.
export async function grantAddOn(tenantId: string, addOnId: string, quantity: number): Promise<TenantAddOn> {
  const { data } = await apiClient.post<TenantAddOn>(`/super-admin/businesses/${tenantId}/addons`, { addOnId, quantity });
  return data;
}

export async function cancelTenantAddOn(tenantId: string, tenantAddOnId: string): Promise<TenantAddOn> {
  const { data } = await apiClient.patch<TenantAddOn>(`/super-admin/businesses/${tenantId}/addons/${tenantAddOnId}`);
  return data;
}

export type ServiceType = "UI_CHANGE" | "NEW_MODULE" | "CUSTOM_WORKFLOW" | "API_INTEGRATION" | "SCHEMA_CHANGE" | "CUSTOM_FEATURE" | "ENTERPRISE_CUSTOM";
export type RequestStatus = "Requested" | "Quoted" | "Approved" | "InProgress" | "Completed" | "Invoiced" | "Cancelled";

export type CustomDevelopmentRequest = {
  id: string;
  tenantId: string;
  tenant: { id: string; businessName: string };
  serviceType: ServiceType;
  description: string;
  status: RequestStatus;
  quotedAmount: number | null;
  notes: string | null;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
};

// The whole cross-tenant queue, optionally filtered by status.
export async function listCustomDevelopmentRequests(status?: RequestStatus): Promise<CustomDevelopmentRequest[]> {
  const { data } = await apiClient.get<CustomDevelopmentRequest[]>("/super-admin/custom-development", {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function updateCustomDevelopmentRequest(
  id: string,
  input: { status?: RequestStatus; quotedAmount?: number | null; notes?: string | null }
): Promise<CustomDevelopmentRequest> {
  const { data } = await apiClient.patch<CustomDevelopmentRequest>(`/super-admin/custom-development/${id}`, input);
  return data;
}
