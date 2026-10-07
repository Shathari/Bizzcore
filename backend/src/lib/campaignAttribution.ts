import { z } from "zod";
import { prisma } from "./prisma";

export const offerCodeSchema = z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Use letters, numbers, hyphens or underscores for the offer code");
export const campaignOfferFields = {
  title: z.string().trim().min(1).max(120).optional(),
  offerEnabled: z.boolean().optional(),
  offerCode: offerCodeSchema.optional(),
  offerDescription: z.string().trim().min(1).max(500).optional(),
  offerStartsAt: z.string().datetime({ offset: true }).optional(),
  offerEndsAt: z.string().datetime({ offset: true }).optional(),
};
export const candidateSelect = { id: true, title: true, caption: true, publishedAt: true, offerEnabled: true, offerCode: true, offerDescription: true, offerStartsAt: true, offerEndsAt: true } as const;
export function offerIsValid(campaign: { offerEnabled: boolean; offerStartsAt: Date | null; offerEndsAt: Date | null }, at: Date) {
  return campaign.offerEnabled && (!campaign.offerStartsAt || campaign.offerStartsAt <= at) && (!campaign.offerEndsAt || campaign.offerEndsAt >= at);
}

// Aggregation is tenant scoped and batched; purchases remain the revenue ledger.
export async function campaignMetrics(tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { sent: number; delivered: number; read: number; failed: number; physicalSales: number; attributedRevenue: number; offerRedemptions: number }>();
  const [sends, delivered, read, failed, purchases, redemptions] = await Promise.all([
    prisma.broadcastRecipient.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids } }, _count: { id: true } }),
    prisma.broadcastRecipient.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids }, deliveredAt: { not: null } }, _count: { id: true } }),
    prisma.broadcastRecipient.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids }, readAt: { not: null } }, _count: { id: true } }),
    prisma.broadcastRecipient.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids }, failedAt: { not: null } }, _count: { id: true } }),
    prisma.purchase.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids } }, _count: { id: true }, _sum: { amount: true } }),
    prisma.offerRedemption.groupBy({ by: ["broadcastId"], where: { tenantId, broadcastId: { in: ids } }, _count: { id: true } }),
  ]);
  return new Map(ids.map((id) => [id, { sent: sends.find((r) => r.broadcastId === id)?._count.id ?? 0, delivered: delivered.find((r) => r.broadcastId === id)?._count.id ?? 0, read: read.find((r) => r.broadcastId === id)?._count.id ?? 0, failed: failed.find((r) => r.broadcastId === id)?._count.id ?? 0, physicalSales: purchases.find((r) => r.broadcastId === id)?._count.id ?? 0, attributedRevenue: Math.round((purchases.find((r) => r.broadcastId === id)?._sum.amount ?? 0) * 100) / 100, offerRedemptions: redemptions.find((r) => r.broadcastId === id)?._count.id ?? 0 }]));
}
