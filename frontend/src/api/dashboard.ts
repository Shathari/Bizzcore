import { apiClient } from "./client";

export type DashboardSummary = {
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
