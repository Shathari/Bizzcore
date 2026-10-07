import { apiClient } from "./client";

export type DashboardSummary = {
  whatsappCampaigns?: Array<{ id: string; title: string; sent: number; delivered: number; read: number; failed: number; physicalSales: number; attributedRevenue: number; offerRedemptions: number }>;
  modules: { whatsappRepeatSales: boolean; website: boolean };
  todaysInquiries: number;
  websiteVisitorsToday: number;
  newCustomersToday: number;
  pendingFollowUps: number;
  revenueTrend: Array<{ month: string; revenue: number }>;
  priorityFollowUps: Array<{
    id: string;
    name: string;
    phoneMasked: string;
    segment: string;
    lastPurchase: string | null;
    totalSpent: number;
  }>;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await apiClient.get<DashboardSummary>("/dashboard/summary");
  return data;
}
