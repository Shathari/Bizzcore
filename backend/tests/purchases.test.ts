import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { app, createTenantWithAdmin, createTestCustomer, createSuperAdmin, loginAs } from "./helpers";
// helpers loads app.ts's async error patch before constructing route handlers.
import purchaseRoutes from "../src/routes/purchases";
import { prisma } from "../src/lib/prisma";
import { hashForLookup } from "../src/lib/piiCrypto";
import { recomputeInactiveCustomersForTenant, daysSinceLastPurchase } from "../src/lib/customerSegmentation";

async function fixture(role = "ADMIN", consentStatus = "UNKNOWN") {
  const { tenant, admin } = await createTenantWithAdmin();
  if (role !== "ADMIN") await prisma.user.update({ where: { id: admin.id }, data: { role } });
  const cookie = await loginAs(admin.email);
  const customer = await createTestCustomer(tenant.id, { phone: "+919800000088", totalSpent: 100, consentStatus });
  return { tenant, admin, customer, cookie };
}
function sale(customerId: string, extra: Record<string, unknown> = {}) {
  return { customerId, amount: 125.50, requestId: randomUUID(), ...extra };
}
describe("purchase entry foundation", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["ADMIN", "EMPLOYEE"])("allows %s to record a tenant sale and read derived history", async (role) => {
    const { tenant, customer, cookie } = await fixture(role);
    const purchasedAt = new Date(Date.now() - 60_000).toISOString();
    const response = await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id, { purchasedAt }));
    expect(response.status).toBe(201);
    expect(response.body.purchase).toMatchObject({ tenantId: tenant.id, customerId: customer.id, amount: 125.50, purchasedAt });
    const updated = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(updated.totalSpent).toBe(225.50);
    expect(updated.lastPurchase?.toISOString()).toBe(purchasedAt);
    const history = await request(app).get(`/api/purchases/customers/${customer.id}`).set("Cookie", cookie);
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ purchaseCount: 1, recordedTotalSpent: 125.50 });
    expect(history.body.purchases).toHaveLength(1);
    expect(history.body.customer).not.toHaveProperty("phone");
    expect(history.body.customer).not.toHaveProperty("phoneHash");
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).post("/api/purchases").send(sale("missing"))).status).toBe(401);
    expect((await request(app).post("/api/purchases/customer-lookup").send({ phone: "919800000088" })).status).toBe(401);
  });

  it("preserves Super Admin separation from tenant purchase operations", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale("missing"))).status).toBe(403);
  });

  it("keeps employee permissions limited to operational purchase endpoints", async () => {
    const { cookie } = await fixture("EMPLOYEE");
    for (const path of ["/api/settings/integrations", "/api/subscription", "/api/customers", "/api/customers/export", "/api/whatsapp/templates", "/api/dashboard/summary", "/api/super-admin/businesses"]) {
      expect((await request(app).get(path).set("Cookie", cookie)).status, path).toBe(403);
    }
    expect((await request(app).post("/api/customers").set("Cookie", cookie).send({ name: "New", phone: "919800000088" })).status).toBe(403);
  });

  it("rejects suspended tenant access and forced-password sessions", async () => {
    const { tenant, admin, cookie, customer } = await fixture("EMPLOYEE");
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "Suspended" } });
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id))).status).toBe(403);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "Active" } });
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });
    const forced = await loginAs(admin.email);
    expect((await request(app).post("/api/purchases").set("Cookie", forced).send(sale(customer.id))).status).toBe(403);
  });

  it.each(["+919800000088", "919800000088", "+91 98000 00088"])("looks up current and legacy phone hashes for %s within this tenant", async (phone) => {
    const { customer, cookie } = await fixture("EMPLOYEE");
    await prisma.customer.update({ where: { id: customer.id }, data: { phoneHash: hashForLookup("+919800000088") } });
    const response = await request(app).post("/api/purchases/customer-lookup").send({ phone }).set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.customers.map((c: { id: string }) => c.id)).toEqual([customer.id]);
    expect(response.body.customers[0]).not.toHaveProperty("phoneHash");
  });

  it.each(["ADMIN", "EMPLOYEE"])("keeps %s body-based lookup PII out of production-style request logs and storage", async (role) => {
    const { tenant, customer, cookie } = await fixture(role);
    const logs: string[] = [];
    // Match app.ts's default pino-http serialization; capture its output
    // because the shared test app intentionally disables request logging.
    const loggingApp = express();
    loggingApp.use(express.json(), cookieParser(), pinoHttp({}, { write: (line: string) => { logs.push(line); } }));
    loggingApp.use("/api/purchases", purchaseRoutes);
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    const response = await request(loggingApp).post("/api/purchases/customer-lookup")
      .set("Cookie", cookie).send({ phone: "+919800000088" });
    expect(response.status).toBe(200);
    expect(response.body.customers.map((c: { id: string }) => c.id)).toEqual([customer.id]);
    expect(response.body.customers[0].phoneMasked).toBe(before.phoneMasked);
    for (const field of ["phone", "phoneHash", "birthday"]) expect(response.body.customers[0]).not.toHaveProperty(field);
    await expect.poll(() => logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      const logged = JSON.parse(line);
      expect(logged.req.url).toBe("/api/purchases/customer-lookup");
      expect(logged.req.query).toEqual({});
      expect(logged.req).not.toHaveProperty("body");
      expect(line).not.toContain("919800000088");
    }
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
    expect(await prisma.customer.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect(before.phone).not.toContain("919800000088");
    expect((await request(app).get("/api/purchases/customer-lookup").set("Cookie", cookie)).status).toBe(404);
  });

  it("does not expose or write another tenant's customer, including spoofed tenant IDs", async () => {
    const { cookie } = await fixture("EMPLOYEE");
    const other = await createTenantWithAdmin();
    const customer = await createTestCustomer(other.tenant.id, { phone: "+919900000099" });
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id))).status).toBe(404);
    expect((await request(app).get(`/api/purchases/customers/${customer.id}`).set("Cookie", cookie)).status).toBe(404);
    const response = await request(app).post("/api/purchases/customer-lookup").send({ phone: "919900000099", tenantId: other.tenant.id }).set("Cookie", cookie);
    expect(response.body.customers).toEqual([]);
    expect(response.body.message).toMatch(/No customer found/);
    expect(await prisma.purchase.count({ where: { tenantId: other.tenant.id } })).toBe(0);
  });

  it.each([0, -1, "12", "oops", null, 1.001, 1_000_000_001])("rejects invalid amount %s", async (amount) => {
    const { customer, cookie } = await fixture();
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id, { amount }))).status).toBe(400);
  });

  it("rejects malformed data, dates and missing customers", async () => {
    const { customer, cookie } = await fixture();
    for (const data of [{}, sale(customer.id, { requestId: "invalid" }), sale(customer.id, { purchasedAt: "bad-date" }), sale(customer.id, { purchasedAt: new Date(Date.now() + 86400_000).toISOString() }), sale(customer.id, { tenantId: "spoof" })]) {
      expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(data)).status).toBe(400);
    }
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale("missing"))).status).toBe(404);
  });

  it("replays a request without creating a second sale or incrementing metrics twice; conflicts on changed payload", async () => {
    const { tenant, customer, cookie } = await fixture();
    const input = sale(customer.id);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(input)).status).toBe(201);
    const replay = await request(app).post("/api/purchases").set("Cookie", cookie).send(input);
    expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send({ ...input, amount: 126 })).status).toBe(409);
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).totalSpent).toBe(225.50);
  });

  it.each([
    { name: "explicit date with identical date", explicit: true, replay: "same", status: 200 },
    { name: "explicit date with equivalent timezone", explicit: true, replay: "timezone", status: 200 },
    { name: "explicit date removed", explicit: true, replay: "omitted", status: 409 },
    { name: "explicit date changed", explicit: true, replay: "changed", status: 409 },
    { name: "omitted date remains omitted", explicit: false, replay: "omitted", status: 200 },
    { name: "omitted date becomes explicit even at the stored instant", explicit: false, replay: "same", status: 409 },
  ])("preserves original request semantics: $name", async ({ explicit, replay, status }) => {
    const { tenant, customer, cookie } = await fixture();
    const date = "2026-10-01T00:00:00.000Z";
    const input = sale(customer.id, explicit ? { purchasedAt: date } : {});
    const first = await request(app).post("/api/purchases").set("Cookie", cookie).send(input);
    expect(first.status).toBe(201);
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    const replayInput = { customerId: input.customerId, amount: input.amount, requestId: input.requestId,
      ...(replay === "omitted" ? {} : { purchasedAt: replay === "changed" ? "2026-09-30T00:00:00.000Z"
        : replay === "timezone" ? "2026-10-01T05:30:00.000+05:30" : first.body.purchase.purchasedAt }) };
    const response = await request(app).post("/api/purchases").set("Cookie", cookie).send(replayInput);
    expect(response.status).toBe(status);
    if (status === 200) {
      expect(response.body.replayed).toBe(true);
      expect(response.body.purchase.id).toBe(first.body.purchase.id);
    }
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
  });

  it("rejects reuse of a request ID for a different customer", async () => {
    const { tenant, customer, cookie } = await fixture();
    const other = await createTestCustomer(tenant.id, { phone: "+919900000099" });
    const input = sale(customer.id);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(input)).status).toBe(201);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send({ ...input, customerId: other.id })).status).toBe(409);
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: other.id } })).totalSpent).toBe(other.totalSpent);
  });

  it("allows independent tenants to use the same request ID without exposing each other's purchase", async () => {
    const first = await fixture("EMPLOYEE");
    const second = await fixture("EMPLOYEE");
    const requestId = randomUUID();
    const ids: string[] = [];
    for (const f of [first, second]) {
      const input = sale(f.customer.id, { requestId });
      const response = await request(app).post("/api/purchases").set("Cookie", f.cookie).send(input);
      expect(response.status).toBe(201);
      expect(response.body.purchase.tenantId).toBe(f.tenant.id);
      ids.push(response.body.purchase.id);
      const replay = await request(app).post("/api/purchases").set("Cookie", f.cookie).send(input);
      expect(replay.status).toBe(200);
      expect(replay.body.purchase.id).toBe(response.body.purchase.id);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).totalSpent).toBe(225.50);
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(await prisma.purchase.count({ where: { requestId } })).toBe(2);
  });

  it("fails closed for an existing request whose original date semantics were not persisted", async () => {
    const { tenant, customer, cookie } = await fixture();
    const input = sale(customer.id);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(input)).status).toBe(201);
    await prisma.purchase.updateMany({ where: { tenantId: tenant.id }, data: { requestFingerprint: null } });
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(input)).status).toBe(409);
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).totalSpent).toBe(225.50);
  });

  it.each([true, false])("uses the same fingerprint comparison after a database unique conflict (matching: %s)", async (matching) => {
    const { customer, cookie } = await fixture();
    const input = sale(customer.id, { purchasedAt: "2026-10-01T00:00:00.000Z" });
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(input)).status).toBe(201);
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(Object.assign(new Error("Concurrent unique conflict"), { code: "P2002" }));
    const replay = matching ? input : { customerId: input.customerId, amount: input.amount, requestId: input.requestId };
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(replay)).status).toBe(matching ? 200 : 409);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
  });

  it("enforces one Purchase for concurrent duplicate requests", async () => {
    const { tenant, customer, cookie } = await fixture();
    const input = sale(customer.id);
    const responses = await Promise.all([1, 2].map(() => request(app).post("/api/purchases").set("Cookie", cookie).send(input)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).totalSpent).toBe(225.50);
  });

  it("keeps the latest purchase date when staff records an older sale", async () => {
    const { customer, cookie } = await fixture();
    const lastPurchase = new Date(Date.now() - 86400_000);
    await prisma.customer.update({ where: { id: customer.id }, data: { lastPurchase } });
    const old = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id, { purchasedAt: old }))).status).toBe(201);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).lastPurchase).toEqual(lastPurchase);
  });

  it.each(["UNKNOWN", "OPTED_OUT", "OPTED_IN"])("preserves %s consent and consent history", async (state) => {
    const { customer, cookie } = await fixture("EMPLOYEE", state);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id))).status).toBe(201);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).consentStatus).toBe(state);
    expect(await prisma.consentEvent.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("feeds existing revenue and inactivity calculations without a separate revenue counter", async () => {
    const { tenant, customer, cookie } = await fixture();
    await prisma.customer.update({ where: { id: customer.id }, data: { lastPurchase: new Date(Date.now() - 100 * 86400_000) } });
    await recomputeInactiveCustomersForTenant(tenant.id, 90);
    expect(await prisma.customerTagAssignment.count({ where: { customerId: customer.id, source: "SYSTEM" } })).toBe(1);
    const before = await request(app).get("/api/dashboard/summary").set("Cookie", cookie);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id))).status).toBe(201);
    await recomputeInactiveCustomersForTenant(tenant.id, 90);
    expect(await prisma.customerTagAssignment.count({ where: { customerId: customer.id, source: "SYSTEM" } })).toBe(0);
    expect(daysSinceLastPurchase(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }))).toBe(0);
    const after = await request(app).get("/api/dashboard/summary").set("Cookie", cookie);
    expect(after.body.revenueTrend[5].revenue - before.body.revenueTrend[5].revenue).toBe(125.50);
  });

  it("rolls back Purchase when the customer update fails", async () => {
    const { tenant, customer, cookie } = await fixture();
    const originalTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(((callback: (tx: unknown) => Promise<unknown>, options: unknown) => originalTransaction(async (tx) => {
      const originalUpdate = tx.customer.update;
      tx.customer.update = (() => { throw new Error("Simulated metric write failure"); }) as typeof originalUpdate;
      return callback(tx);
    }, options as Parameters<typeof originalTransaction>[1])) as typeof prisma.$transaction);
    expect((await request(app).post("/api/purchases").set("Cookie", cookie).send(sale(customer.id))).status).toBe(500);
    expect(await prisma.purchase.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).totalSpent).toBe(100);
  });
});
