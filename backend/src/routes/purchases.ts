import { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { Prisma, type Purchase } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { normalizePhone, phoneLookupHashes } from "../lib/piiCrypto";
import { daysSinceLastPurchase } from "../lib/customerSegmentation";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN", "EMPLOYEE"));
const customerSelect = { id: true, name: true, phoneMasked: true, totalSpent: true, lastPurchase: true } as const;
const phoneSchema = z.string().trim().refine((phone) => /^\+?[\d\s().-]+$/.test(phone) && /^\d{6,15}$/.test(normalizePhone(phone)), "Enter a valid phone number including its country code");

router.post("/customer-lookup", async (req, res) => {
  const parsed = phoneSchema.safeParse(req.body?.phone);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid phone number including its country code" }); return; }
  const customers = await prisma.customer.findMany({
    where: { tenantId: req.tenantId!, phoneHash: { in: phoneLookupHashes(parsed.data) } },
    select: customerSelect, orderBy: { createdAt: "asc" },
  });
  // Returning a list lets staff select among legacy duplicate phone records.
  res.json({ customers, message: customers.length ? null : "No customer found for this phone number." });
});

router.get("/customers/:customerId", async (req, res) => {
  const tenantId = req.tenantId!;
  const customer = await prisma.customer.findFirst({ where: { id: req.params.customerId, tenantId }, select: customerSelect });
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const where = { tenantId, customerId: customer.id };
  const [aggregate, purchases] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
    prisma.purchase.findMany({ where, select: { id: true, amount: true, purchasedAt: true }, orderBy: [{ purchasedAt: "desc" }, { id: "desc" }], take: 50 }),
  ]);
  res.json({ customer, purchaseCount: aggregate._count.id,
    recordedTotalSpent: Math.round((aggregate._sum.amount ?? 0) * 100) / 100,
    daysSinceLastPurchase: daysSinceLastPurchase(customer), purchases,
    historyLimited: aggregate._count.id > purchases.length });
});

const saleSchema = z.object({
  customerId: z.string().min(1).max(128), requestId: z.string().uuid(),
  // Purchase.amount is Float in the established schema. Accept only monetary
  // values expressible to two decimal places, with a bounded positive amount.
  amount: z.number().finite().positive().max(1_000_000_000).refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001, "Amount must have at most two decimal places"),
  purchasedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

router.post("/", async (req, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid sale" }); return; }
  const input = parsed.data;
  const tenantId = req.tenantId!;
  const amount = Math.round(input.amount * 100) / 100;
  const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
  // Null means the original request omitted the date, not the server-assigned
  // timestamp. Normalize explicit dates to UTC and money to integer cents.
  const requestFingerprint = createHash("sha256").update(JSON.stringify([
    1, tenantId, input.customerId, Math.round(amount * 100),
    input.purchasedAt === undefined ? null : purchasedAt.toISOString(),
  ])).digest("hex");
  if (purchasedAt.getTime() > Date.now() + 60_000) { res.status(400).json({ error: "A completed sale cannot be in the future" }); return; }
  const respondExisting = (existing: Purchase) => {
    // Pre-fingerprint rows cannot establish original date semantics: fail
    // closed rather than guessing or incrementing customer metrics again.
    if (existing.requestFingerprint !== requestFingerprint) {
      res.status(409).json({ error: "This request ID already belongs to a different sale" });
    } else res.status(200).json({ purchase: existing, replayed: true });
  };
  // The unique constraint protects retries across processes and connections.
  // Serializable also prevents concurrent sales from losing cached metrics.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId }, select: customerSelect });
        if (!customer) return null;
        const existing = await tx.purchase.findUnique({ where: { tenantId_requestId: { tenantId, requestId: input.requestId } } });
        if (existing) return { purchase: existing, replayed: true };
        const purchase = await tx.purchase.create({ data: { tenantId, customerId: customer.id, amount, purchasedAt, requestId: input.requestId, requestFingerprint } });
        // Preserve imported historical totals: Purchase rows cannot reconstruct
        // those old sales. These pre-existing fields remain operational caches.
        await tx.customer.update({ where: { id: customer.id }, data: {
          totalSpent: Math.round((customer.totalSpent + amount) * 100) / 100,
          lastPurchase: !customer.lastPurchase || purchasedAt > customer.lastPurchase ? purchasedAt : customer.lastPurchase,
        } });
        return { purchase, replayed: false };
      }, { isolationLevel: "Serializable" });
      if (!result) { res.status(404).json({ error: "Customer not found" }); return; }
      if (result.replayed) respondExisting(result.purchase);
      else res.status(201).json(result);
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError || (error && typeof error === "object" && "code" in error)) {
        const code = (error as { code: string }).code;
        if (code === "P2002") {
          const existing = await prisma.purchase.findUnique({ where: { tenantId_requestId: { tenantId, requestId: input.requestId } } });
          if (existing) { respondExisting(existing); return; }
        }
        if (code === "P2034" && attempt < 2) continue;
      }
      throw error; // Existing Express error handler returns a sanitized failure.
    }
  }
});
export default router;
