import { apiClient } from "./client";

export type BillingCycle = "Monthly" | "Yearly";

export type CheckoutSession = {
  invoiceId: string;
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
  plan: { id: string; name: string };
  billingCycle: BillingCycle;
  prefill: { name: string; email: string; contact?: string };
};

export async function startCheckout(planId: string, billingCycle: BillingCycle): Promise<CheckoutSession> {
  const { data } = await apiClient.post<CheckoutSession>("/billing/checkout", { planId, billingCycle });
  return data;
}

export type InvoiceStatus = "Created" | "Paid" | "Failed" | "Cancelled";

export type Invoice = {
  id: string;
  planId: string;
  plan: { id: string; name: string };
  amount: number; // ₹
  billingCycle: BillingCycle;
  razorpayOrderId: string;
  status: InvoiceStatus;
  createdAt: string;
};

export async function listMyInvoices(): Promise<Invoice[]> {
  const { data } = await apiClient.get<Invoice[]>("/billing/invoices");
  return data;
}
