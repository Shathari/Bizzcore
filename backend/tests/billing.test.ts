import crypto from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Mocks the `razorpay` package's default export so no real network call is
// ever made. `createOrderMock` is shared (via vi.hoisted) across every
// `new Razorpay(...)` instance the app code creates — integrations/
// razorpay.ts caches its client as a module-level singleton, so different
// tests in this file may or may not get a fresh instance, but they always
// get the same controllable mock function either way. It echoes back the
// amount/currency it was given by default (enough to assert routes/
// billing.ts computed the right paise amount), and one test overrides it
// with a rejection to exercise the order-creation-failure path.
//
// `validateWebhookSignature` is a REAL HMAC-SHA256 implementation (not a
// stub) — it's pure crypto with no network I/O, so there's no reason to
// fake it, and doing it for real is what actually proves
// routes/webhooks/razorpay.ts's signature check works.
const { createOrderMock } = vi.hoisted(() => ({ createOrderMock: vi.fn() }));

vi.mock("razorpay", () => {
  class MockRazorpay {
    orders = { create: createOrderMock };
    static validateWebhookSignature(body: string, signature: string, secret: string): boolean {
      const nodeCrypto: typeof import("crypto") = require("crypto");
      const expected = nodeCrypto.createHmac("sha256", secret).update(body).digest("hex");
      return expected === signature;
    }
  }
  return { default: MockRazorpay };
});

async function getActivePlan() {
  return prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } });
}

describe("Billing (Razorpay) — checkout", () => {
  beforeEach(() => {
    createOrderMock.mockReset().mockImplementation(async (params: { amount: number; currency: string }) => ({
      id: `order_mock_${crypto.randomBytes(6).toString("hex")}`,
      amount: params.amount,
      currency: params.currency,
    }));
  });

  afterEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it("creates a Razorpay order + a Pending invoice for a valid plan", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await getActivePlan();

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", cookie)
      .send({ planId: plan.id, billingCycle: "Monthly" });

    expect(res.status).toBe(201);
    expect(res.body.keyId).toBe("rzp_test_fake_key_id");
    expect(res.body.amount).toBe(Math.round(plan.priceMonthly * 100));
    expect(res.body.currency).toBe("INR");
    expect(res.body.plan).toEqual({ id: plan.id, name: plan.name });
    expect(res.body.billingCycle).toBe("Monthly");
    expect(res.body.prefill).toEqual({ name: expect.stringContaining("Test Boutique"), email: tenant.ownerEmail, contact: undefined });

    const invoice = await prisma.invoice.findUnique({ where: { id: res.body.invoiceId } });
    expect(invoice).toMatchObject({
      tenantId: tenant.id,
      planId: plan.id,
      billingCycle: "Monthly",
      status: "Created",
      razorpayOrderId: res.body.orderId,
    });
  });

  it("uses the yearly price when billingCycle is Yearly", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await getActivePlan();

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", cookie)
      .send({ planId: plan.id, billingCycle: "Yearly" });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(Math.round(plan.priceYearly * 100));
  });

  it("rejects an unknown plan with 400", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", cookie)
      .send({ planId: "not-a-real-plan-id", billingCycle: "Monthly" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid billingCycle with 400", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await getActivePlan();

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", cookie)
      .send({ planId: plan.id, billingCycle: "Weekly" });
    expect(res.status).toBe(400);
  });

  it("rejects checkout against a deactivated plan", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await getActivePlan();
    await prisma.plan.update({ where: { id: plan.id }, data: { isActive: false } });

    try {
      const res = await request(app)
        .post("/api/billing/checkout")
        .set("Cookie", cookie)
        .send({ planId: plan.id, billingCycle: "Monthly" });
      expect(res.status).toBe(400);
    } finally {
      await prisma.plan.update({ where: { id: plan.id }, data: { isActive: true } });
    }
  });

  it("returns 502 if Razorpay order creation fails", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    createOrderMock.mockReset().mockRejectedValueOnce(new Error("network down"));

    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const plan = await getActivePlan();

    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Cookie", cookie)
      .send({ planId: plan.id, billingCycle: "Monthly" });
    expect(res.status).toBe(502);
  });

  it("lists only this tenant's own invoices, most recent first", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake_key_id";
    process.env.RAZORPAY_KEY_SECRET = "fake_key_secret";
    const { tenant: tenantA, admin: adminA } = await createTenantWithAdmin("Boutique A");
    const { tenant: tenantB, admin: adminB } = await createTenantWithAdmin("Boutique B");
    const cookieA = await loginAs(adminA.email);
    const cookieB = await loginAs(adminB.email);
    const plan = await getActivePlan();

    await request(app).post("/api/billing/checkout").set("Cookie", cookieA).send({ planId: plan.id, billingCycle: "Monthly" });
    await request(app).post("/api/billing/checkout").set("Cookie", cookieA).send({ planId: plan.id, billingCycle: "Yearly" });
    await request(app).post("/api/billing/checkout").set("Cookie", cookieB).send({ planId: plan.id, billingCycle: "Monthly" });

    const resA = await request(app).get("/api/billing/invoices").set("Cookie", cookieA);
    expect(resA.body).toHaveLength(2);
    expect(resA.body.every((inv: { tenantId: string }) => inv.tenantId === tenantA.id)).toBe(true);
    expect(resA.body[0].billingCycle).toBe("Yearly"); // most recent first

    const resB = await request(app).get("/api/billing/invoices").set("Cookie", cookieB);
    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].tenantId).toBe(tenantB.id);
  });
});

describe("Razorpay webhook — POST /api/webhooks/razorpay", () => {
  const SECRET = "test-webhook-secret";

  afterEach(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  function sign(bodyString: string, secret = SECRET): string {
    return crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
  }

  async function createPendingInvoice(razorpayOrderId: string) {
    const { tenant } = await createTenantWithAdmin();
    const plan = await getActivePlan();
    const invoice = await prisma.invoice.create({
      data: { tenantId: tenant.id, planId: plan.id, amount: plan.priceMonthly, billingCycle: "Monthly", razorpayOrderId, status: "Created" },
    });
    return { tenant, plan, invoice };
  }

  it("returns 500 when RAZORPAY_WEBHOOK_SECRET isn't configured", async () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x" } } } });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", "irrelevant")
      .send(body);
    expect(res.status).toBe(500);
  });

  it("rejects a request with an invalid signature", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x" } } } });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", "0".repeat(64))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  it("acknowledges but ignores events it doesn't act on", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_x", order_id: "order_x" } } } });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
  });

  it("acknowledges a payment for an order with no matching invoice", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_x", order_id: "order_never_created", currency: "INR" } } },
    });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("no matching invoice");
  });

  it("activates the plan end-to-end on a verified payment.captured", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const { tenant, plan, invoice } = await createPendingInvoice("order_captured_1");
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_captured_1", order_id: "order_captured_1", currency: "INR" } } },
    });

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    const updatedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.status).toBe("Paid");

    const updatedTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(updatedTenant.planId).toBe(plan.id);
    expect(updatedTenant.subscriptionStatus).toBe("Active");
    expect(updatedTenant.currentPeriodEnd).not.toBeNull();

    const payment = await prisma.payment.findUnique({ where: { razorpayPaymentId: "pay_captured_1" } });
    expect(payment).toMatchObject({ tenantId: tenant.id, invoiceId: invoice.id, status: "Captured" });
  });

  it("is idempotent — a retried webhook delivery for the same payment is a no-op", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const { tenant, invoice } = await createPendingInvoice("order_captured_2");
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_captured_2", order_id: "order_captured_2", currency: "INR" } } },
    });
    const signature = sign(body);

    const first = await request(app).post("/api/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).send(body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("ok");

    const tenantAfterFirst = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });

    const second = await request(app).post("/api/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).send(body);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("already processed");

    const paymentCount = await prisma.payment.count({ where: { razorpayPaymentId: "pay_captured_2" } });
    expect(paymentCount).toBe(1); // not doubled

    const tenantAfterSecond = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(tenantAfterSecond.currentPeriodEnd?.getTime()).toBe(tenantAfterFirst.currentPeriodEnd?.getTime()); // not re-extended

    const invoiceRow = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceRow.status).toBe("Paid");
  });

  it("records a failed payment without activating the plan", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const { tenant, invoice } = await createPendingInvoice("order_failed_1");
    const body = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_failed_1", order_id: "order_failed_1", currency: "INR", error_description: "Card declined" } } },
    });

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);

    const updatedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.status).toBe("Failed");

    const updatedTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(updatedTenant.planId).toBeNull(); // never activated

    const payment = await prisma.payment.findUnique({ where: { razorpayPaymentId: "pay_failed_1" } });
    expect(payment?.status).toBe("Failed");
  });

  it("reflects a confirmed payment back through GET /api/billing/invoices", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const { tenant, admin } = await createTenantWithAdmin();
    const plan = await getActivePlan();
    await prisma.invoice.create({
      data: { tenantId: tenant.id, planId: plan.id, amount: plan.priceMonthly, billingCycle: "Monthly", razorpayOrderId: "order_visible_1", status: "Created" },
    });
    const cookie = await loginAs(admin.email);

    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_visible_1", order_id: "order_visible_1", currency: "INR" } } },
    });
    await request(app).post("/api/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", sign(body)).send(body);

    const res = await request(app).get("/api/billing/invoices").set("Cookie", cookie);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("Paid");
  });
});
