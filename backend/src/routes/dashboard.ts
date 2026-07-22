import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Priority follow-ups: VIP/Bridal customers who either have never
// purchased or haven't purchased in FOLLOW_UP_STALE_DAYS — the schema has
// no explicit "flagged for outreach" field, so this is the practical
// stand-in for "high-value customer who's gone quiet."
const FOLLOW_UP_STALE_DAYS = 30;
const FOLLOW_UP_LIMIT = 10;
const REVENUE_TREND_MONTHS = 6;

router.get("/summary", async (req, res) => {
  const tenantId = req.tenantId!;
  const todayStart = startOfToday();

  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - FOLLOW_UP_STALE_DAYS);

  const trendStart = new Date();
  trendStart.setMonth(trendStart.getMonth() - (REVENUE_TREND_MONTHS - 1));
  trendStart.setDate(1);
  trendStart.setHours(0, 0, 0, 0);

  const [todaysInquiries, websiteVisitorsToday, newCustomersToday, followUpCandidates, purchases] =
    await Promise.all([
      prisma.inquiry.count({ where: { tenantId, createdAt: { gte: todayStart } } }), // tenant-scoped
      prisma.websiteVisit.count({ where: { tenantId, visitedAt: { gte: todayStart } } }), // tenant-scoped
      prisma.customer.count({ where: { tenantId, createdAt: { gte: todayStart } } }), // tenant-scoped
      prisma.customer.findMany({
        where: {
          tenantId, // tenant-scoped
          segment: { in: ["VIP", "Bridal"] },
          OR: [{ lastPurchase: null }, { lastPurchase: { lt: staleThreshold } }],
        },
        // phoneMasked only — never phone. The frontend's Call action
        // decrypts the real number on demand via POST /customers/:id/call,
        // which logs the access; this list itself must stay safe to render.
        select: { id: true, name: true, phoneMasked: true, segment: true, lastPurchase: true, totalSpent: true },
        orderBy: { lastPurchase: "asc" },
      }),
      prisma.purchase.findMany({
        where: { tenantId, purchasedAt: { gte: trendStart } }, // tenant-scoped
        select: { amount: true, purchasedAt: true },
      }),
    ]);

  // Bucket purchases into calendar months in application code — Prisma has
  // no portable groupBy-by-month across SQLite/Postgres without raw SQL.
  const now = new Date();
  const buckets: Array<{ key: string; label: string }> = [];
  for (let i = REVENUE_TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    });
  }
  const totals = new Map(buckets.map((b) => [b.key, 0]));
  for (const p of purchases) {
    const d = new Date(p.purchasedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (totals.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + p.amount);
    }
  }
  const revenueTrend = buckets.map((b) => ({ month: b.label, revenue: totals.get(b.key) ?? 0 }));

  res.json({
    todaysInquiries,
    websiteVisitorsToday,
    newCustomersToday,
    pendingFollowUps: followUpCandidates.length,
    revenueTrend,
    priorityFollowUps: followUpCandidates.slice(0, FOLLOW_UP_LIMIT).map((c) => ({
      id: c.id,
      name: c.name,
      phoneMasked: c.phoneMasked,
      segment: c.segment,
      lastPurchase: c.lastPurchase,
      totalSpent: c.totalSpent,
    })),
  });
});

export default router;
