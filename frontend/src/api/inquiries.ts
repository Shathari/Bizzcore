import { apiClient } from "./client";

export const INQUIRY_SOURCES = ["WEBSITE", "WHATSAPP", "INSTAGRAM"] as const;
export type InquirySource = (typeof INQUIRY_SOURCES)[number];

export const INQUIRY_STATUSES = ["open", "followed_up", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export type Inquiry = {
  id: string;
  source: InquirySource;
  message: string;
  status: InquiryStatus;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  preferredAt: string | null;
  customerId: string | null;
  customer: { id: string; name: string; phoneMasked: string } | null;
  createdAt: string;
};

export async function listInquiries(params?: { status?: InquiryStatus; source?: InquirySource; search?: string }): Promise<Inquiry[]> {
  const { data } = await apiClient.get<Inquiry[]>("/inquiries", { params });
  return data;
}

export async function updateInquiryStatus(id: string, status: InquiryStatus): Promise<Inquiry> {
  const { data } = await apiClient.patch<Inquiry>(`/inquiries/${id}/status`, { status });
  return data;
}

export async function deleteInquiry(id: string): Promise<void> {
  await apiClient.delete(`/inquiries/${id}`);
}

export async function convertInquiryToCustomer(id: string): Promise<Inquiry> {
  const { data } = await apiClient.post<Inquiry>(`/inquiries/${id}/convert-to-customer`);
  return data;
}
