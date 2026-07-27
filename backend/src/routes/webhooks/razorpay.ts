import { Router } from "express";
import Razorpay from "razorpay";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { sendEmail } from "../../integrations/email";

// Server-to-server confirmation for real-money checkout — see
// routes/billing.ts's file comment. Razorpay calls this directly (no
// browser involved), so there's no session/JWT to check; the HMAC
// signature over the raw body IS the authentication. Mounted in app.ts
// with express.raw() BEFORE the global express.json(), since the
// signature is computed over the exact bytes Razorpay sent — re-serializing
// parsed JSON would produce a different signature and always fail.
const router = Router();

const ADMIN_ALERT_EMAIL = "bizzcore225@gmail.com";

// 30/365 days, matching the day-based period convention already used for
// manual grants (see routes/superAdminPlans.ts, routes/superAdminSubscriptions.ts)
// rather than calendar-month arithmetic.
function periodEndFor(billingCycle: string, from: Date): Date {
  const days = billingCycle === "Yearly" ? 365 : 30;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

router.post("/", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const rawBody = req.body; // Buffer — see express.raw() mount in app.ts

  if (!secret) {
    console.error("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }
  if (typeof signature !== "string" || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Missing signature or body" });
    return;
  }

  const isValid = Razorpay.validateWebhookSignature(rawBody.toString("utf8"), signature, secret);
  if (!isValid) {
    console.error("Razorpay webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  const rawBodyText = rawBody.toString("utf8");
  const event = JSON.parse(rawBodyText);
  const entity = event?.payload?.payment?.entity;

  // Anything we don't act on (order.paid, refund.*, etc.) is acknowledged
  // as a no-op rather than a 4xx, so Razorpay doesn't keep retrying an
  // event this app deliberately doesn't handle.
  if (!entity || (event.event !== "payment.captured" && event.event !== "payment.failed")) {
    res.status(200).json({ status: "ignored" });
    return;
  }

  const invoice = await prisma.invoice.findUnique({ where: { razorpayOrderId: entity.order_id } });
  if (!invoice) {
    console.error(`Razorpay webhook for unknown order ${entity.order_id}`);
    res.status(200).json({ status: "no matching invoice" });
    return;
  }

  const existingPayment = await prisma.payment.findUnique({ where: { razorpayPaymentId: entity.id } });
  if (existingPayment) {
    // Razorpay retries webhook delivery; the unique razorpayPaymentId makes
    // a repeat delivery a no-op instead of double-extending the plan.
    res.status(200).json({ status: "already processed" });
    return;
  }

  try {
    if (event.event === "payment.captured") {
      const now = new Date();
      await prisma.$transaction([
        prisma.payment.create({
          data: {
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            planId: invoice.planId,
            amount: invoice.amount,
            currency: entity.currency ?? "INR",
            razorpayOrderId: entity.order_id,
            razorpayPaymentId: entity.id,
            razorpaySignature: signature,
            status: "Captured",
            rawWebhookPayload: rawBodyText,
          },
        }),
        prisma.invoice.update({ where: { id: invoice.id }, data: { status: "Paid" } }),
        prisma.tenant.update({
          where: { id: invoice.tenantId },
          data: {
            planId: invoice.planId,
            subscriptionStatus: "Active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEndFor(invoice.billingCycle, now),
          },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.payment.create({
          data: {
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            planId: invoice.planId,
            amount: invoice.amount,
            currency: entity.currency ?? "INR",
            razorpayOrderId: entity.order_id,
            razorpayPaymentId: entity.id,
            razorpaySignature: signature,
            status: "Failed",
            rawWebhookPayload: rawBodyText,
          },
        }),
        prisma.invoice.update({ where: { id: invoice.id }, data: { status: "Failed" } }),
      ]);

      const tenant = await prisma.tenant.findUnique({ where: { id: invoice.tenantId } });
      await sendEmail({
        to: ADMIN_ALERT_EMAIL,
        subject: `Razorpay payment failed — ${tenant?.businessName ?? invoice.tenantId}`,
        text: [
          `A Razorpay payment failed for ${tenant?.businessName ?? "tenant " + invoice.tenantId}.`,
          ``,
          `Invoice: ${invoice.id}`,
          `Order: ${entity.order_id}`,
          `Payment: ${entity.id}`,
          `Amount: ${invoice.amount} (${invoice.billingCycle})`,
          `Reason: ${entity.error_description ?? "not provided by Razorpay"}`,
        ].join("\n"),
      });
    }
  } catch (err) {
    // A unique-constraint race (two near-simultaneous deliveries for the
    // same payment) is the same "already processed" outcome as the
    // earlier existingPayment check, just lost the race to it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(200).json({ status: "already processed" });
      return;
    }
    console.error("Razorpay webhook processing failed", err);
    res.status(500).json({ error: "Processing failed" });
    return;
  }

  res.status(200).json({ status: "ok" });
});

export default router;
