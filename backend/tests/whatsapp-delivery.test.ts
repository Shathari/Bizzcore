import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createHmac } from "crypto";
import { app, createTenantWithAdmin, createTestCustomer, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";
import { encryptField } from "../src/lib/piiCrypto";
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage, sendPlatformWhatsAppMessage } from "../src/integrations/whatsapp";
import { processWhatsAppBroadcast } from "../src/jobs/scheduler";
import { campaignMetrics } from "../src/lib/campaignAttribution";
import { logger } from "../src/lib/logger";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  const { tenant } = await createTenantWithAdmin();
  await grantPermissivePlan(tenant.id);
  const phoneNumberId = `delivery-${tenant.id}`;
  await prisma.integrationCredential.create({ data: { tenantId: tenant.id, provider: "WHATSAPP", externalId: phoneNumberId, encryptedPayload: encrypt(JSON.stringify({ phoneNumberId, accessToken: "synthetic-secret" })) } });
  const customer = await createTestCustomer(tenant.id, { consentStatus: "OPTED_IN" });
  const broadcast = await prisma.scheduledContent.create({ data: { tenantId: tenant.id, kind: "WHATSAPP_BROADCAST", channel: "WHATSAPP", caption: "Synthetic body", scheduledAt: new Date(), targetCustomerId: customer.id } });
  return { tenant, customer, broadcast, phoneNumberId };
}
const accepted = () => new Response(JSON.stringify({ messages: [{ id: "synthetic-wamid" }] }), { status: 200 });

describe("validated WhatsApp acceptance and broadcast accounting", () => {
  it.each([
    ["valid ID", { messages: [{ id: "synthetic-wamid" }] }, true],
    ["missing messages", {}, false], ["empty messages", { messages: [] }, false],
    ["missing ID", { messages: [{}] }, false], ["null ID", { messages: [{ id: null }] }, false],
    ["empty ID", { messages: [{ id: "" }] }, false], ["whitespace ID", { messages: [{ id: " \t " }] }, false],
    ["numeric ID", { messages: [{ id: 123 }] }, false], ["non-array messages", { messages: { 0: { id: "synthetic-wamid" } } }, false],
    ["malformed JSON", null, false],
  ] as const)("accounts only accepted sends: %s", async (_label, body, success) => {
    const f = await fixture();
    vi.spyOn(global, "fetch").mockImplementation(async () => new Response(body === null ? "invalid JSON" : JSON.stringify(body), { status: 200 }));
    await processWhatsAppBroadcast(f.broadcast);
    const rows = await prisma.broadcastRecipient.findMany({ where: { tenantId: f.tenant.id } });
    expect(rows).toHaveLength(success ? 1 : 0);
    if (success) expect(rows[0]).toMatchObject({ externalId: "synthetic-wamid", deliveredAt: null, readAt: null, failedAt: null });
    const usage = await prisma.usageCounter.findFirst({ where: { tenantId: f.tenant.id, featureKey: "WHATSAPP_MESSAGES" } });
    expect(usage?.count ?? 0).toBe(success ? 1 : 0);
    expect((await prisma.scheduledContent.findUniqueOrThrow({ where: { id: f.broadcast.id } })).status).toBe(success ? "published" : "failed");
    expect((await campaignMetrics(f.tenant.id, [f.broadcast.id])).get(f.broadcast.id)?.sent).toBe(success ? 1 : 0);
  });
  it.each([400, 500, "network"])("rejects %s without evidence, charging or unsafe errors", async failure => {
    const f = await fixture(); const warn = vi.spyOn(logger, "warn");
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      if (failure === "network") throw new Error("synthetic-secret +919876543210 sensitive body");
      return new Response(JSON.stringify({ error: { code: 131026, type: "OAuthException", error_subcode: 7, message: "synthetic-secret +919876543210 sensitive body" } }), { status: Number(failure) });
    });
    await processWhatsAppBroadcast(f.broadcast);
    expect(await prisma.broadcastRecipient.count({ where: { tenantId: f.tenant.id } })).toBe(0);
    expect((await prisma.usageCounter.findFirst({ where: { tenantId: f.tenant.id, featureKey: "WHATSAPP_MESSAGES" } }))?.count ?? 0).toBe(0);
    const content = await prisma.scheduledContent.findUniqueOrThrow({ where: { id: f.broadcast.id } });
    expect(content.status).toBe("failed");
    const diagnostics = JSON.stringify([warn.mock.calls, content.errorMessage]);
    expect(diagnostics).not.toContain("synthetic-secret"); expect(diagnostics).not.toContain("919876543210"); expect(diagnostics).not.toContain("sensitive body");
    if (failure !== "network") expect(warn.mock.calls[0][0]).toMatchObject({ failureCode: 131026, errorType: "OAuthException", errorSubcode: 7, httpStatus: failure });
  });
  it.each(["919876543210", "+919876543210", "+91 (98765) 43210", "91-98765-43210"])("normalizes permitted formatting before Meta: %s", async phone => {
    const f = await fixture(); const info = vi.spyOn(logger, "info"); const warn = vi.spyOn(logger, "warn"); const consoleSpy = vi.spyOn(console, "log");
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => accepted());
    const result = await sendWhatsAppMessage(f.tenant.id, phone, "private synthetic body");
    expect(result).toMatchObject({ accepted: true, externalId: "synthetic-wamid" });
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).to).toBe("919876543210");
    const logs = JSON.stringify([info.mock.calls, warn.mock.calls, consoleSpy.mock.calls]);
    for (const value of [phone, "919876543210", "private synthetic body", "synthetic-secret"]) expect(logs).not.toContain(value);
  });
  it.each(["abc", "+91abc9876543210", "++919876543210", "00919876543210", "123", "+0123456789", "1234567890123456"])("rejects invalid stored phone before Meta: %s", async phone => {
    const f = await fixture(); await prisma.customer.update({ where: { id: f.customer.id }, data: { phone: encryptField(phone) } });
    const fetchSpy = vi.spyOn(global, "fetch"); await processWhatsAppBroadcast(f.broadcast);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.broadcastRecipient.count({ where: { tenantId: f.tenant.id } })).toBe(0);
    expect((await prisma.usageCounter.findFirst({ where: { tenantId: f.tenant.id, featureKey: "WHATSAPP_MESSAGES" } }))?.count ?? 0).toBe(0);
  });
  it("preserves selected template name, language and ordered BODY parameters", async () => {
    const f = await fixture(); const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => accepted());
    await sendWhatsAppTemplateMessage(f.tenant.id, "+919876543210", "create_new_order", "en_US", ["first", "second"]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).template).toEqual({ name: "create_new_order", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }] });
  });
  it("never prints full phones in tenant/template/platform mock paths", async () => {
    const { tenant } = await createTenantWithAdmin(); const warn = vi.spyOn(logger, "warn"); const consoleSpy = vi.spyOn(console, "log");
    vi.stubEnv("WHATSAPP_PLATFORM_ACCESS_TOKEN", ""); vi.stubEnv("WHATSAPP_PLATFORM_PHONE_NUMBER_ID", "");
    const phone = "+919876543210";
    await sendWhatsAppMessage(tenant.id, phone, "private body");
    await sendWhatsAppTemplateMessage(tenant.id, phone, "approved", "en_US");
    await sendPlatformWhatsAppMessage(phone, { businessName: "Private", email: "private@example.com", tempPassword: "private-password", loginUrl: "https://example.com" });
    const logs = JSON.stringify([warn.mock.calls, consoleSpy.mock.calls]);
    expect(logs).not.toContain(phone); expect(logs).not.toContain("919876543210"); expect(logs).not.toContain("private-password"); expect(logs).not.toContain("private body");
  });
});

describe("signed broadcast delivery-failure receipts", () => {
  async function receiptFixture() {
    const a = await fixture(); const b = await fixture();
    for (const f of [a, b]) {
      await prisma.broadcastRecipient.create({ data: { tenantId: f.tenant.id, customerId: f.customer.id, broadcastId: f.broadcast.id, externalId: "shared-wamid" } });
      const conversation = await prisma.conversation.create({ data: { tenantId: f.tenant.id, channel: "WHATSAPP", contactHandle: f.customer.id } });
      await prisma.message.create({ data: { tenantId: f.tenant.id, conversationId: conversation.id, direction: "OUTBOUND", externalId: "shared-wamid", status: "sent", body: "Fixture" } });
    }
    vi.stubEnv("WHATSAPP_APP_SECRET", "synthetic-webhook-secret");
    const send = (status: string, id: unknown = "shared-wamid", errors: unknown = [{ code: 131026, message: "private +919876543210", error_data: { details: "private" } }]) => {
      const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: a.phoneNumberId }, statuses: [{ id, status, errors }] } }] }] });
      const signature = "sha256=" + createHmac("sha256", "synthetic-webhook-secret").update(body).digest("hex");
      return request(app).post("/api/webhooks/whatsapp").set("Content-Type", "application/json").set("X-Hub-Signature-256", signature).send(body);
    };
    const snapshot = () => prisma.broadcastRecipient.findMany({ where: { tenantId: { in: [a.tenant.id, b.tenant.id] } }, orderBy: { id: "asc" } });
    return { a, b, send, snapshot };
  }
  it("persists sanitized failure only for the resolved tenant and exposes failure without subtracting acceptance", async () => {
    const f = await receiptFixture(); const before = await f.snapshot(); const info = vi.spyOn(logger, "info");
    expect((await f.send("failed")).status).toBe(200);
    const after = await f.snapshot(); const a = after.find(r => r.tenantId === f.a.tenant.id)!;
    expect(a).toMatchObject({ externalId: "shared-wamid", failureCode: 131026, failureCategory: "META_DELIVERY_FAILED", deliveredAt: null, readAt: null }); expect(a.failedAt).toBeInstanceOf(Date);
    expect(after.find(r => r.tenantId === f.b.tenant.id)).toEqual(before.find(r => r.tenantId === f.b.tenant.id));
    expect((await campaignMetrics(f.a.tenant.id, [f.a.broadcast.id])).get(f.a.broadcast.id)).toEqual({ sent: 1, delivered: 0, read: 0, failed: 1, physicalSales: 0, offerRedemptions: 0, attributedRevenue: 0 });
    expect(JSON.stringify([after, info.mock.calls])).not.toContain("919876543210"); expect(JSON.stringify(info.mock.calls)).not.toContain("private");
    expect(info.mock.calls.at(-1)![0]).toMatchObject({ event: "whatsapp.receipt", recipientCount: 1, messageCount: 1, matched: true });
    const failed = await f.snapshot(); await f.send("failed"); expect(await f.snapshot()).toEqual(failed);
  });
  it.each(["delivered", "read"])("preserves %s against subsequent failed/sent events", async status => {
    const f = await receiptFixture(); await f.send(status); const before = await f.snapshot();
    await f.send("failed"); await f.send("sent"); expect(await f.snapshot()).toEqual(before);
    expect((await prisma.message.findFirstOrThrow({ where: { tenantId: f.a.tenant.id } })).status).toBe(status);
    expect((await campaignMetrics(f.a.tenant.id, [f.a.broadcast.id])).get(f.a.broadcast.id)?.failed).toBe(0);
  });
  it("allows stronger delivery/read evidence to supersede failure", async () => {
    const f = await receiptFixture(); await f.send("failed"); await f.send("delivered"); await f.send("read");
    const a = (await f.snapshot()).find(r => r.tenantId === f.a.tenant.id)!;
    expect(a).toMatchObject({ failedAt: null, failureCode: null, failureCategory: null }); expect(a.deliveredAt).toBeInstanceOf(Date); expect(a.readAt).toBeInstanceOf(Date);
    expect((await campaignMetrics(f.a.tenant.id, [f.a.broadcast.id])).get(f.a.broadcast.id)).toMatchObject({ sent: 1, delivered: 1, read: 1, failed: 0 });
  });
  it.each([null, "", "   ", 123, {}, [], "unknown-wamid"])("ignores invalid/unknown failure IDs: %j", async id => {
    const f = await receiptFixture(); const before = await f.snapshot(); await f.send("failed", id); expect(await f.snapshot()).toEqual(before);
  });
  it("does not persist arbitrary error codes or text", async () => {
    const f = await receiptFixture(); await f.send("failed", "shared-wamid", [{ code: "private +919876543210", title: "private", message: "private" }]);
    expect((await f.snapshot()).find(r => r.tenantId === f.a.tenant.id)).toMatchObject({ failureCode: null, failureCategory: "META_DELIVERY_FAILED" });
  });
  it("cannot mark another tenant's exclusive WAMID as failed", async () => {
    const f = await receiptFixture();
    await prisma.broadcastRecipient.updateMany({ where: { tenantId: f.b.tenant.id }, data: { externalId: "other-tenant-wamid" } });
    await prisma.message.updateMany({ where: { tenantId: f.b.tenant.id }, data: { externalId: "other-tenant-wamid" } });
    const before = await f.snapshot();
    const messages = await prisma.message.findMany({ where: { tenantId: { in: [f.a.tenant.id, f.b.tenant.id] } }, orderBy: { id: "asc" } });
    expect((await f.send("failed", "other-tenant-wamid")).status).toBe(200);
    expect(await f.snapshot()).toEqual(before);
    expect(await prisma.message.findMany({ where: { tenantId: { in: [f.a.tenant.id, f.b.tenant.id] } }, orderBy: { id: "asc" } })).toEqual(messages);
  });
});
