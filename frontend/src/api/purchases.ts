import { apiClient } from "./client";
export type SaleCustomer = { id: string; name: string; phoneMasked: string; totalSpent: number; lastPurchase: string | null };
export type Purchase = { id: string; amount: number; purchasedAt: string };
export type PurchaseSummary = { customer: SaleCustomer; purchaseCount: number; recordedTotalSpent: number; daysSinceLastPurchase: number | null; purchases: Purchase[]; historyLimited: boolean };
export async function lookupSaleCustomer(phone: string) {
  return (await apiClient.post<{ customers: SaleCustomer[]; message: string | null }>("/purchases/customer-lookup", { phone })).data;
}
export async function getPurchaseSummary(customerId: string) {
  return (await apiClient.get<PurchaseSummary>(`/purchases/customers/${customerId}`)).data;
}
export async function recordSale(input: { customerId: string; amount: number; requestId: string; purchasedAt?: string }) {
  return (await apiClient.post<{ purchase: Purchase; replayed: boolean }>("/purchases", input)).data;
}
