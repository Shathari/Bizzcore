import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { randomUUID, createHmac } from "crypto";
import { app, createTenantWithAdmin, createTestCustomer, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { processWhatsAppBroadcast } from "../src/jobs/scheduler";
import { encrypt } from "../src/lib/crypto";
import * as modules from "../src/lib/modules";

async function fixture(role = "ADMIN", offer = false) {
  const { tenant, admin } = await createTenantWithAdmin();
  if (role !== "ADMIN") await prisma.user.update({ where: { id: admin.id }, data: { role } });
  const cookie = await loginAs(admin.email);
  const customer = await createTestCustomer(tenant.id, { totalSpent: 100, consentStatus: "OPTED_OUT" });
  const broadcast = await prisma.scheduledContent.create({ data: { tenantId: tenant.id, kind: "WHATSAPP_BROADCAST", channel: "WHATSAPP", title: "Festive collection", caption: "Visit our store", scheduledAt: new Date(Date.now() - 86400000), publishedAt: new Date(Date.now() - 86400000), status: "published", offerEnabled: offer, offerCode: offer ? "FESTIVE10" : null, offerDescription: offer ? "Store offer" : null } });
  const recipient = await prisma.broadcastRecipient.create({ data: { tenantId: tenant.id, broadcastId: broadcast.id, customerId: customer.id, sentAt: new Date(Date.now() - 86400000) } });
  return { tenant, admin, cookie, customer, broadcast, recipient };
}
function sale(f: Awaited<ReturnType<typeof fixture>>, extra = {}) { return { customerId: f.customer.id, amount: 50, requestId: randomUUID(), purchasedAt: new Date(Date.now() - 60000).toISOString(), ...extra }; }
const post = (f: Awaited<ReturnType<typeof fixture>>, body: object) => request(app).post("/api/purchases").set("Cookie", f.cookie).send(body);
const candidates = (f: Awaited<ReturnType<typeof fixture>>, body = {}) => request(app).post(`/api/purchases/customers/${f.customer.id}/campaigns`).set("Cookie", f.cookie).send(body);

describe("physical-store campaign attribution", () => {
  it("rejects Customer B claiming Customer A's evidence", async () => {
    const f = await fixture("EMPLOYEE"); const b = await createTestCustomer(f.tenant.id);
    const list = await request(app).post(`/api/purchases/customers/${b.id}/campaigns`).set("Cookie", f.cookie).send({});
    expect(list.body.campaigns).toEqual([]);
    expect((await post(f, sale(f, { customerId: b.id, broadcastId: f.broadcast.id }))).status).toBe(400);
    expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });
  it.each([0, -1, 90 * 86400000 + 1])("enforces the inclusive 90-day window at offset %s", async offset => {
    const f = await fixture(); const purchasedAt = new Date(Date.now() - 60000);
    await prisma.broadcastRecipient.update({ where: { id: f.recipient.id }, data: { sentAt: new Date(purchasedAt.getTime() - 90 * 86400000 + offset) } });
    const eligible = offset === 0;
    expect((await candidates(f, { purchasedAt: purchasedAt.toISOString() })).body.campaigns.length).toBe(eligible ? 1 : 0);
    expect((await post(f, sale(f, { purchasedAt: purchasedAt.toISOString(), broadcastId: f.broadcast.id }))).status).toBe(eligible ? 201 : 400);
  });
  it("redeems an Oct 4 sale entered Oct 6 under an Oct 1-5 offer", async () => {
    const f = await fixture("EMPLOYEE", true);
    await prisma.scheduledContent.update({ where: { id: f.broadcast.id }, data: { offerStartsAt: new Date("2026-10-01T00:00:00Z"), offerEndsAt: new Date("2026-10-05T23:59:59Z") } });
    await prisma.broadcastRecipient.update({ where: { id: f.recipient.id }, data: { sentAt: new Date("2026-10-02T00:00:00Z") } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    try {
      expect((await post(f, sale(f, { purchasedAt: "2026-10-04T12:00:00Z", broadcastId: f.broadcast.id, redeemOffer: true, offerCode: "FESTIVE10" }))).status).toBe(201);
      expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("resolves identical offer codes independently across tenants", async () => {
    const a = await fixture("EMPLOYEE", true); const b = await fixture("EMPLOYEE", true);
    for (const f of [a, b]) {
      expect((await candidates(f, { offerCode: " festive10 " })).body.campaigns.map((c: { id: string }) => c.id)).toEqual([f.broadcast.id]);
      expect((await post(f, sale(f, { broadcastId: f === a ? b.broadcast.id : a.broadcast.id, redeemOffer: true, offerCode: "FESTIVE10" }))).status).toBe(400);
    }
  });
  it.each([true, false])("rejects changing accepted redemption selection from %s", async redeemOffer => {
    const f = await fixture("ADMIN", true); const body = sale(f, { broadcastId: f.broadcast.id, redeemOffer });
    expect((await post(f, body)).status).toBe(201);
    expect((await post(f, { ...body, redeemOffer: !redeemOffer })).status).toBe(409);
    expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(1);
    expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(redeemOffer ? 1 : 0);
  });
  it("rejects changing an accepted normalized offer code in replay identity", async () => {
    const f = await fixture("ADMIN", true); const body = sale(f, { broadcastId: f.broadcast.id, redeemOffer: true, offerCode: "FESTIVE10" });
    expect((await post(f, body)).status).toBe(201);
    expect((await post(f, { ...body, offerCode: " festive10 " })).status).toBe(200);
    expect((await post(f, { ...body, offerCode: "OTHER10" })).status).toBe(409);
    expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(1);
  });
  afterEach(() => vi.restoreAllMocks());
  it("records a walk-in without attribution or redemption", async () => {
    const f = await fixture(); const response = await post(f, sale(f)); expect(response.status).toBe(201); expect(response.body.purchase.broadcastId).toBeNull(); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });
  it.each(["ADMIN", "EMPLOYEE"])("permits %s campaign attribution without an offer", async (role) => {
    const f = await fixture(role); const eligible = await candidates(f); expect(eligible.status).toBe(200); expect(eligible.body.campaigns[0]).toMatchObject({ id: f.broadcast.id, offerEnabled: false });
    expect(eligible.body.campaigns[0]).not.toHaveProperty("caption"); expect(eligible.body.campaigns[0]).not.toHaveProperty("recipients");
    const result = await post(f, sale(f, { broadcastId: f.broadcast.id })); expect(result.status).toBe(201); expect(result.body.purchase.broadcastId).toBe(f.broadcast.id); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(0);
    const history = await request(app).get(`/api/purchases/customers/${f.customer.id}`).set("Cookie", f.cookie); expect(history.body.purchases[0].broadcast.id).toBe(f.broadcast.id);
  });
  it.each(["ADMIN", "EMPLOYEE"])("allows %s to redeem an offer with a normalized code", async (role) => {
    const f = await fixture(role, true); const lookup = await candidates(f, { offerCode: " festive10 " }); expect(lookup.status).toBe(200); expect(lookup.body.campaigns[0].offerEligible).toBe(true);
    const result = await post(f, sale(f, { broadcastId: f.broadcast.id, redeemOffer: true, offerCode: " festive10 " })); expect(result.status).toBe(201);
    const redemption = await prisma.offerRedemption.findUniqueOrThrow({ where: { purchaseId: result.body.purchase.id } }); expect(redemption).toMatchObject({ tenantId: f.tenant.id, customerId: f.customer.id, broadcastId: f.broadcast.id, recordedByUserId: f.admin.id, offerCode: "FESTIVE10" }); expect(redemption).not.toHaveProperty("amount");
  });
  it("distinguishes attribution from optional redemption on an offer campaign", async () => {
    const f = await fixture("ADMIN", true); expect((await post(f, sale(f, { broadcastId: f.broadcast.id }))).status).toBe(201); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });
  it("replays a sale once, preserves consent, and prevents a second redemption", async () => {
    const f = await fixture("EMPLOYEE", true); const body = sale(f, { broadcastId: f.broadcast.id, redeemOffer: true });
    const first = await post(f, body); const retry = await post(f, body); expect(first.status).toBe(201); expect(retry.status).toBe(200); expect(retry.body.purchase.id).toBe(first.body.purchase.id);
    expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(1); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(1);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } }); expect(row.totalSpent).toBe(150); expect(row.consentStatus).toBe("OPTED_OUT"); expect(await prisma.consentEvent.count({ where: { customerId: f.customer.id } })).toBe(0);
    const redemption = await prisma.offerRedemption.findUniqueOrThrow({ where: { purchaseId: first.body.purchase.id } });
    await expect(prisma.offerRedemption.create({ data: { tenantId: redemption.tenantId, broadcastId: redemption.broadcastId, customerId: redemption.customerId, purchaseId: redemption.purchaseId, recordedByUserId: redemption.recordedByUserId, redeemedAt: redemption.redeemedAt } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.scheduledContent.update({ where: { id: f.broadcast.id }, data: { offerEndsAt: new Date(0) } }); expect((await post(f, body)).status).toBe(200);
  });
  it("handles concurrent identical attributed requests without duplicate sales or redemptions", async () => {
    const f = await fixture("EMPLOYEE", true); const body = sale(f, { broadcastId: f.broadcast.id, redeemOffer: true });
    const responses = await Promise.all([post(f, body), post(f, body)]); expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(1); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(1); expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).totalSpent).toBe(150);
  });
  it("rolls back the financial write if redemption persistence fails", async () => {
    const f = await fixture("ADMIN", true); const originalTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(((callback: (tx: unknown) => Promise<unknown>, options: unknown) => originalTransaction(async (tx) => {
      tx.offerRedemption.create = (() => { throw new Error("Simulated redemption failure"); }) as typeof tx.offerRedemption.create;
      return callback(tx);
    }, options as Parameters<typeof originalTransaction>[1])) as typeof prisma.$transaction);
    expect((await post(f, sale(f, { broadcastId: f.broadcast.id, redeemOffer: true }))).status).toBe(500); expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(0); expect(await prisma.offerRedemption.count({ where: { tenantId: f.tenant.id } })).toBe(0); expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).totalSpent).toBe(100);
  });
  it("updates delivery/read evidence from signed tenant-resolved webhook events without regression", async () => {
    const f = await fixture(); const phoneNumberId = `phone-${randomUUID()}`; const secret = "synthetic-attribution-secret"; vi.stubEnv("WHATSAPP_APP_SECRET", secret);
    await prisma.integrationCredential.create({ data: { tenantId: f.tenant.id, provider: "WHATSAPP", externalId: phoneNumberId, encryptedPayload: encrypt(JSON.stringify({ phoneNumberId, accessToken: "synthetic" })) } });
    await prisma.broadcastRecipient.update({ where: { id: f.recipient.id }, data: { externalId: "wamid-receipt" } });
    for (const status of ["read", "delivered", "sent"]) {
      const event = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: "wamid-receipt", status }] } }] }] });
      const signature = `sha256=${createHmac("sha256", secret).update(event).digest("hex")}`;
      expect((await request(app).post("/api/webhooks/whatsapp").set("Content-Type", "application/json").set("X-Hub-Signature-256", signature).send(event)).status).toBe(200);
    }
    const row = await prisma.broadcastRecipient.findUniqueOrThrow({ where: { id: f.recipient.id } }); expect(row.deliveredAt).not.toBeNull(); expect(row.readAt).not.toBeNull(); vi.unstubAllEnvs();
  });
  it.each(["changed", "omitted", "added", "redemption"])("rejects conflicting replay: %s", async (change) => {
    const f = await fixture("ADMIN", true); const body = sale(f, change === "added" ? {} : { broadcastId: f.broadcast.id }); expect((await post(f, body)).status).toBe(201);
    const retry: Record<string, unknown> = { ...body };
    if (change === "changed") retry.broadcastId = "different-campaign";
    if (change === "omitted") delete retry.broadcastId;
    if (change === "added") retry.broadcastId = f.broadcast.id;
    if (change === "redemption") retry.redeemOffer = true;
    expect((await post(f, retry)).status).toBe(409); expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(1);
  });
  it.each(["expired", "future", "wrong-code", "disabled-offer"])("rejects invalid redemption: %s", async (reason) => {
    const f = await fixture("ADMIN", true);
    await prisma.scheduledContent.update({ where: { id: f.broadcast.id }, data: reason === "expired" ? { offerEndsAt: new Date(0) } : reason === "future" ? { offerStartsAt: new Date(Date.now() + 86400000) } : reason === "disabled-offer" ? { offerEnabled: false } : {} });
    expect((await post(f, sale(f, { broadcastId: f.broadcast.id, redeemOffer: true, offerCode: reason === "wrong-code" ? "WRONG" : "FESTIVE10" }))).status).toBe(400);
    expect((await candidates(f, { offerCode: reason === "wrong-code" ? "WRONG" : "FESTIVE10" })).status).toBe(404); expect(await prisma.purchase.count({ where: { tenantId: f.tenant.id } })).toBe(0);
  });
  it("requires recipient evidence and refuses sales predating the accepted send", async () => {
    const f = await fixture(); await prisma.broadcastRecipient.update({ where: { id: f.recipient.id }, data: { sentAt: new Date(Date.now() + 86400000) } });
    expect((await candidates(f)).body.campaigns).toEqual([]); expect((await post(f, sale(f, { broadcastId: f.broadcast.id }))).status).toBe(400);
    await prisma.broadcastRecipient.delete({ where: { id: f.recipient.id } }); expect((await post(f, sale(f, { broadcastId: f.broadcast.id }))).status).toBe(400);
  });
  it("isolates campaigns, codes, customer lookup and history across tenants", async () => {
    const a = await fixture("EMPLOYEE"); const b = await fixture("ADMIN", true);
    expect((await post(a, sale(a, { broadcastId: b.broadcast.id }))).status).toBe(400); expect((await candidates(a, { offerCode: "FESTIVE10" })).status).toBe(404);
    expect((await request(app).post(`/api/purchases/customers/${b.customer.id}/campaigns`).set("Cookie", a.cookie).send({})).status).toBe(404);
    expect((await request(app).get(`/api/purchases/customers/${b.customer.id}`).set("Cookie", a.cookie)).status).toBe(404);
    for (const method of ["get", "post"] as const) expect((await request(app)[method]("/api/communication/broadcasts").set("Cookie", a.cookie).send({})).status).toBe(403);
  });
  it("keeps lastPurchase at the latest date for backdated attributed sales", async () => {
    const f = await fixture(); const latest = new Date(); await prisma.customer.update({ where: { id: f.customer.id }, data: { lastPurchase: latest } }); expect((await post(f, sale(f, { broadcastId: f.broadcast.id }))).status).toBe(201);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).lastPurchase).toEqual(latest);
  });
  it("derives Physical Sales, Attributed Revenue and Offer Redemptions from financial records", async () => {
    const f = await fixture("ADMIN", true); await post(f, sale(f, { broadcastId: f.broadcast.id, amount: 33.99 })); await post(f, sale(f, { broadcastId: f.broadcast.id, redeemOffer: true }));
    await prisma.broadcastRecipient.update({ where: { id: f.recipient.id }, data: { deliveredAt: new Date(), readAt: new Date() } });
    const list = await request(app).get("/api/communication/broadcasts").set("Cookie", f.cookie); expect(list.body[0].metrics).toEqual({ sent: 1, delivered: 1, read: 1, failed: 0, physicalSales: 2, attributedRevenue: 83.99, offerRedemptions: 1 });
  });
  it.each([false, true])("gates Home campaign metrics by the module (enabled=%s)", async (enabled) => {
    const f = await fixture(); vi.spyOn(modules, "getActiveModules").mockResolvedValue({ whatsappRepeatSales: enabled, website: false });
    const response = await request(app).get("/api/dashboard/summary").set("Cookie", f.cookie); expect(response.status).toBe(200);
    if (enabled) expect(response.body.whatsappCampaigns[0].id).toBe(f.broadcast.id); else expect(response.body).not.toHaveProperty("whatsappCampaigns");
  });
  it("creates normalized tenant-scoped offer codes through the existing broadcast API", async () => {
    const f = await fixture(); const body = { title: "New arrivals", caption: "Come visit", targetCustomerId: f.customer.id, scheduledAt: new Date().toISOString(), offerEnabled: true, offerCode: " new10 " };
    const created = await request(app).post("/api/communication/broadcasts").set("Cookie", f.cookie).send(body); expect(created.status).toBe(201); expect(created.body.offerCode).toBe("NEW10");
    expect((await request(app).post("/api/communication/broadcasts").set("Cookie", f.cookie).send(body)).status).toBe(409);
    expect((await request(app).post("/api/communication/broadcasts").set("Cookie", f.cookie).send({ ...body, offerEnabled: false })).status).toBe(400);
  });
  it.each([true, false])("stores recipient evidence only for successful live sends (success=%s)", async (success) => {
    const f = await fixture(); await grantPermissivePlan(f.tenant.id); await prisma.broadcastRecipient.deleteMany({ where: { tenantId: f.tenant.id } });
    await prisma.customer.update({ where: { id: f.customer.id }, data: { consentStatus: "OPTED_IN" } });
    await prisma.integrationCredential.create({ data: { tenantId: f.tenant.id, provider: "WHATSAPP", encryptedPayload: encrypt(JSON.stringify({ phoneNumberId: "phone-attribution", accessToken: "synthetic" })) } });
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: success, status: success ? 200 : 500, json: async () => ({ messages: [{ id: "wamid-attribution" }] }), text: async () => "Failed" } as Response);
    await processWhatsAppBroadcast({ ...f.broadcast, targetCustomerId: f.customer.id }); expect(await prisma.broadcastRecipient.count({ where: { tenantId: f.tenant.id } })).toBe(success ? 1 : 0);
  });
});
