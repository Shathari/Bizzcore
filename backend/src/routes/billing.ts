import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { createOrder, getPublicKeyId } from "../integrations/razorpay";

// Tenant-facing real-money checkout — distinct from routes/subscription.ts,
// which is entirely read-only/Super-Admin-actioned (see that file's header
// comment). POST /checkout only ever creates a Razorpay order + a Pending
// Invoice row; it never touches Tenant.planId/subscriptionStatus itself.
// The ONLY place that happens is the signature-verified webhook (see
// routes/webhooks/razorpay.ts, added alongside step 3) — a client
// finishing Razorpay Checkout is a UI signal, not proof of payment, so
// nothing here trusts it.
const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const checkoutSchema = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(["Monthly", "Yearly"]),
});

router.post("/checkout", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [tenant, plan] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId! } }), // tenant-scoped
    prisma.plan.findUnique({ where: { id: parsed.data.planId } }),
  ]);
  if (!plan || !plan.isActive) {
    res.status(400).json({ error: "Unknown or inactive plan" });
    return;
  }

  const amount = parsed.data.billingCycle === "Monthly" ? plan.priceMonthly : plan.priceYearly;
  const amountPaise = Math.round(amount * 100);
  const receipt = `inv_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder({
      amountPaise,
      currency: "INR",
      receipt,
      notes: { tenantId: tenant.id, planId: plan.id, billingCycle: parsed.data.billingCycle },
    });
  } catch (err) {
    console.error("Razorpay order creation failed", err);
    res.status(502).json({ error: "Could not start checkout. Please try again." });
    return;
  }

  const invoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      planId: plan.id,
      amount,
      billingCycle: parsed.data.billingCycle,
      razorpayOrderId: order.orderId,
      status: "Created",
    },
  });

  res.status(201).json({
    invoiceId: invoice.id,
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    keyId: getPublicKeyId(),
    plan: { id: plan.id, name: plan.name },
    billingCycle: parsed.data.billingCycle,
    prefill: { name: tenant.businessName, email: tenant.ownerEmail, contact: tenant.ownerPhone ?? undefined },
  });
});

router.get("/invoices", async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    include: { plan: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(invoices);
});

export default router;
