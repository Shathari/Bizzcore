import { apiClient } from "./client";

export type TenantStatus = "Active" | "Suspended" | "PendingSetup";

export type BusinessSummary = {
  id: string;
  businessName: string;
  websiteUrl: string | null;
  ownerEmail: string;
  ownerPhone: string | null;
  status: TenantStatus;
  logoUrl: string | null;
  deletedAt: string | null;
  createdAt: string;
  customerCount: number;
  lastLogin: string | null;
};

export type DeliveryChannelResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

export type DeliveryResult = {
  email: DeliveryChannelResult;
  sms: DeliveryChannelResult | null;
  fallback?: { tempPassword: string; loginUrl: string };
};

export type CreateBusinessResponse = {
  tenant: { id: string; businessName: string; status: TenantStatus; logoUrl: string | null; createdAt: string };
  admin: { id: string; name: string; email: string; phone: string | null };
  delivery: DeliveryResult;
};

export type BusinessDetail = {
  tenant: {
    id: string;
    businessName: string;
    websiteUrl: string | null;
    customDomain: string | null;
    address: string | null;
    ownerEmail: string;
    ownerPhone: string | null;
    status: TenantStatus;
    logoUrl: string | null;
    planId: string | null;
    plan: { id: string; name: string; priceMonthly: number; priceYearly: number } | null;
    subscriptionStatus: "Active" | "PastDue" | "Cancelled" | "Trialing";
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  }>;
  stats: { customerCount: number };
  auditLog: Array<{
    id: string;
    action: string;
    actor: string;
    actorEmail: string;
    details: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type AuditLogEntry = {
  id: string;
  action: string;
  actor: string;
  actorEmail: string;
  targetBusinessName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export async function listBusinesses(options?: { includeDeleted?: boolean }): Promise<BusinessSummary[]> {
  const { data } = await apiClient.get<BusinessSummary[]>("/super-admin/businesses", {
    params: options?.includeDeleted ? { includeDeleted: "true" } : undefined,
  });
  return data;
}

export async function createBusiness(input: {
  businessName: string;
  websiteUrl?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  logo?: File;
}): Promise<CreateBusinessResponse> {
  const form = new FormData();
  form.append("businessName", input.businessName);
  if (input.websiteUrl) form.append("websiteUrl", input.websiteUrl);
  form.append("ownerName", input.ownerName);
  form.append("ownerEmail", input.ownerEmail);
  if (input.ownerPhone) form.append("ownerPhone", input.ownerPhone);
  if (input.logo) form.append("logo", input.logo);

  const { data } = await apiClient.post<CreateBusinessResponse>("/super-admin/businesses", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getBusinessDetail(id: string): Promise<BusinessDetail> {
  const { data } = await apiClient.get<BusinessDetail>(`/super-admin/businesses/${id}`);
  return data;
}

export async function updateBusinessStatus(id: string, status: "Active" | "Suspended"): Promise<void> {
  await apiClient.patch(`/super-admin/businesses/${id}/status`, { status });
}

export async function updateBusiness(
  id: string,
  input: {
    businessName?: string;
    websiteUrl?: string;
    customDomain?: string;
    address?: string;
    ownerName?: string;
    ownerEmail?: string;
    ownerPhone?: string;
    logo?: File;
  }
): Promise<BusinessDetail["tenant"]> {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (key === "logo" || value === undefined) continue;
    form.append(key, String(value));
  }
  if (input.logo) form.append("logo", input.logo);

  const { data } = await apiClient.patch<BusinessDetail["tenant"]>(`/super-admin/businesses/${id}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteBusiness(id: string, input: { confirmName: string; permanent?: boolean }): Promise<void> {
  await apiClient.delete(`/super-admin/businesses/${id}`, { data: input });
}

export async function restoreBusiness(id: string): Promise<BusinessDetail["tenant"]> {
  const { data } = await apiClient.post<BusinessDetail["tenant"]>(`/super-admin/businesses/${id}/restore`);
  return data;
}

export async function resendCredentials(
  id: string
): Promise<{ admin: { name: string; email: string }; delivery: DeliveryResult }> {
  const { data } = await apiClient.post(`/super-admin/businesses/${id}/resend-credentials`);
  return data;
}

export async function listAuditLog(): Promise<AuditLogEntry[]> {
  const { data } = await apiClient.get<AuditLogEntry[]>("/super-admin/audit-log");
  return data;
}
