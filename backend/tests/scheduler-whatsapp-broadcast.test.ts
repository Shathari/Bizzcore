import { describe, it, expect, vi, afterEach } from "vitest";
import { processWhatsAppBroadcast } from "../src/jobs/scheduler";
import { createTenantWithAdmin, createTestCustomer as createCustomer, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";
import * as accessLog from "../src/lib/accessLog";

// Existing send tests model customers who explicitly consented to marketing.
function createTestCustomer(tenantId: string, overrides: Parameters<typeof createCustomer>[1] = {}) {
  return createCustomer(tenantId, { consentStatus: "OPTED_IN", ...overrides });
}

async function saveWhatsAppCredential(tenantId: string, payload: { phoneNumberId: string; accessToken: string }) {
  await prisma.integrationCredential.create({
    data: {
      tenantId,
      provider: "WHATSAPP",
      encryptedPayload: encrypt(JSON.stringify(payload)),
      externalId: payload.phoneNumberId,
    },
  });
}

function mockSuccessfulSend() {
  return vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.test" }] }) } as Response);
}

function sentPayload(call: [unknown, RequestInit]) {
  return JSON.parse(call[1].body as string);
}

describe("jobs/scheduler.ts processWhatsAppBroadcast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function broadcastFixture(consentStatus = "OPTED_IN", individual = false, template = false) {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const customer = await createTestCustomer(tenant.id, { consentStatus });
    const broadcast = await prisma.scheduledContent.create({ data: {
      tenantId: tenant.id, kind: "WHATSAPP_BROADCAST", channel: "WHATSAPP", caption: "Hello",
      targetCustomerId: individual ? customer.id : null,
      targetSegment: individual ? null : "Regular", scheduledAt: new Date(),
      templateName: template ? "hello" : null, templateLanguage: template ? "en_US" : null,
    } });
    return { tenant, customer, broadcast };
  }

  async function usageCount(tenantId: string) {
    return (await prisma.usageCounter.findFirst({ where: { tenantId, featureKey: "WHATSAPP_MESSAGES" } }))?.count ?? 0;
  }

  it.each([false, true])("counts successful live sends only (template=%s)", async (template) => {
    const { tenant, broadcast } = await broadcastFixture("OPTED_IN", true, template);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-success", accessToken: "token" });
    const fetchSpy = mockSuccessfulSend();
    await processWhatsAppBroadcast(broadcast);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await usageCount(tenant.id)).toBe(1);
    expect((await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } })).status).toBe("published");
  });

  it.each([false, true])("does not consume quota for an API failure (template=%s)", async (template) => {
    const { tenant, broadcast } = await broadcastFixture("OPTED_IN", false, template);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-failure", accessToken: "token" });
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 500, text: async () => "Unavailable" } as Response);
    await processWhatsAppBroadcast(broadcast);
    expect(await usageCount(tenant.id)).toBe(0);
    const updated = await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } });
    expect(updated.status).toBe("failed");
    expect(updated.errorMessage).toMatch(/1 sends unsuccessful/);
  });

  it("does not count mock sends as successful", async () => {
    const { tenant, broadcast } = await broadcastFixture();
    const fetchSpy = mockSuccessfulSend();
    await processWhatsAppBroadcast(broadcast);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await usageCount(tenant.id)).toBe(0);
    expect((await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } })).status).toBe("failed");
  });

  it.each([
    ["UNKNOWN", false], ["UNKNOWN", true], ["OPTED_OUT", false], ["OPTED_OUT", true],
  ] as const)("excludes %s from the audience (individual=%s)", async (state, individual) => {
    const { tenant, broadcast } = await broadcastFixture(state, individual);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-excluded", accessToken: "token" });
    const fetchSpy = mockSuccessfulSend();
    await processWhatsAppBroadcast(broadcast);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await usageCount(tenant.id)).toBe(0);
  });

  it.each([
    ["UNKNOWN", false], ["UNKNOWN", true], ["OPTED_OUT", false], ["OPTED_OUT", true],
  ] as const)("rechecks consent immediately before sending and skips a change to %s (individual=%s)", async (state, individual) => {
    const { tenant, customer, broadcast } = await broadcastFixture("OPTED_IN", individual);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-jit", accessToken: "token" });
    const fetchSpy = mockSuccessfulSend();
    // The audience has already loaded when phone access is logged. Change
    // consent here to exercise the final per-recipient check, not the query.
    const originalLog = accessLog.logAccess;
    vi.spyOn(accessLog, "logAccess").mockImplementationOnce(async (input) => {
      await originalLog(input);
      await prisma.customer.update({ where: { id: customer.id }, data: { consentStatus: state } });
    });
    await processWhatsAppBroadcast(broadcast);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await usageCount(tenant.id)).toBe(0);
    expect((await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } })).errorMessage).toMatch(/no current marketing opt-in/);
  });

  it("uses the remaining quota for a successful recipient after an earlier API failure", async () => {
    const { tenant, broadcast } = await broadcastFixture();
    await createTestCustomer(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-partial", accessToken: "token" });
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureKey: "WHATSAPP_MESSAGES", included: true, value: "1" } });
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "Unavailable" } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "wamid.accepted" }] }) } as Response);
    await processWhatsAppBroadcast(broadcast);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(await usageCount(tenant.id)).toBe(1);
    expect((await prisma.scheduledContent.findUniqueOrThrow({ where: { id: broadcast.id } })).status).toBe("failed");
  });

  it("sends a freeform broadcast to each recipient with {{name}} applied (legacy path, unaffected by template mode)", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-1", accessToken: "token-1" });
    await createTestCustomer(tenant.id, { name: "Asha", segment: "Regular" });
    await createTestCustomer(tenant.id, { name: "Riya", segment: "Regular" });
    const fetchSpy = mockSuccessfulSend();

    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Hi {{name}}, thanks!",
        targetSegment: "Regular",
        scheduledAt: new Date(),
        status: "scheduled",
      },
    });

    await processWhatsAppBroadcast(broadcast);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const bodies = fetchSpy.mock.calls.map((c) => sentPayload(c as [unknown, RequestInit]));
    expect(bodies.map((b) => b.text.body).sort()).toEqual(["Hi Asha, thanks!", "Hi Riya, thanks!"]);
    expect(bodies.every((b) => b.type === "text")).toBe(true);

    const updated = await prisma.scheduledContent.findUnique({ where: { id: broadcast.id } });
    expect(updated?.status).toBe("published");
  });

  it("sends a template broadcast resolving CUSTOMER_FIELD and STATIC placeholders per recipient", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-2", accessToken: "token-2" });
    await createTestCustomer(tenant.id, { name: "Asha", segment: "Regular" });
    await createTestCustomer(tenant.id, { name: "Riya", segment: "Regular" });
    const fetchSpy = mockSuccessfulSend();

    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Hi {{1}}, check out {{2}}.",
        targetSegment: "Regular",
        templateName: "order_dispatch_update",
        templateLanguage: "en_US",
        placeholderConfig: JSON.stringify([
          { index: 1, mode: "CUSTOMER_FIELD", field: "name" },
          { index: 2, mode: "STATIC", value: "our Diwali Sale" },
        ]),
        scheduledAt: new Date(),
        status: "scheduled",
      },
    });

    await processWhatsAppBroadcast(broadcast);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const templatesSent = fetchSpy.mock.calls.map((c) => sentPayload(c as [unknown, RequestInit]).template);
    const namesUsed = templatesSent.map((t) => t.components[0].parameters[0].text).sort();
    expect(namesUsed).toEqual(["Asha", "Riya"]);
    for (const t of templatesSent) {
      expect(t.name).toBe("order_dispatch_update");
      expect(t.language).toEqual({ code: "en_US" });
      expect(t.components[0].parameters[1]).toEqual({ type: "text", text: "our Diwali Sale" });
    }

    const updated = await prisma.scheduledContent.findUnique({ where: { id: broadcast.id } });
    expect(updated?.status).toBe("published");
  });

  it("skips a recipient missing a mapped customer field, sends to the rest, and records a skip note", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-3", accessToken: "token-3" });
    await createTestCustomer(tenant.id, { name: "Asha", segment: "Regular", lastPurchase: new Date("2026-01-01") });
    await createTestCustomer(tenant.id, { name: "Riya", segment: "Regular", lastPurchase: null });
    const fetchSpy = mockSuccessfulSend();

    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Your last order was on {{1}}.",
        targetSegment: "Regular",
        templateName: "reorder_reminder",
        templateLanguage: "en_US",
        placeholderConfig: JSON.stringify([{ index: 1, mode: "CUSTOMER_FIELD", field: "lastPurchase" }]),
        scheduledAt: new Date(),
        status: "scheduled",
      },
    });

    await processWhatsAppBroadcast(broadcast);

    // Only the customer with a lastPurchase on file was actually sent to.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const updated = await prisma.scheduledContent.findUnique({ where: { id: broadcast.id } });
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toMatch(/1 of 2 recipients skipped: 1 missing Last Purchase Date/);

    const usage = await prisma.usageCounter.findFirst({ where: { tenantId: tenant.id, featureKey: "WHATSAPP_MESSAGES" } });
    expect(usage?.count ?? 0).toBe(1); // the skipped recipient never consumed quota
  });

  it("marks the broadcast failed and sends nothing when every recipient is missing the mapped field", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-4", accessToken: "token-4" });
    await createTestCustomer(tenant.id, { name: "Asha", segment: "Regular", lastPurchase: null });
    await createTestCustomer(tenant.id, { name: "Riya", segment: "Regular", lastPurchase: null });
    const fetchSpy = mockSuccessfulSend();

    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Your last order was on {{1}}.",
        targetSegment: "Regular",
        templateName: "reorder_reminder",
        templateLanguage: "en_US",
        placeholderConfig: JSON.stringify([{ index: 1, mode: "CUSTOMER_FIELD", field: "lastPurchase" }]),
        scheduledAt: new Date(),
        status: "scheduled",
      },
    });

    await processWhatsAppBroadcast(broadcast);

    expect(fetchSpy).not.toHaveBeenCalled();
    const updated = await prisma.scheduledContent.findUnique({ where: { id: broadcast.id } });
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toMatch(/2 of 2 recipients skipped: 2 missing Last Purchase Date/);
  });

  it("sends a variable-free template with no bodyParams/components on the outbound payload", async () => {
    const { tenant } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-5", accessToken: "token-5" });
    await createTestCustomer(tenant.id, { name: "Asha", segment: "Regular" });
    const fetchSpy = mockSuccessfulSend();

    const broadcast = await prisma.scheduledContent.create({
      data: {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Thanks for shopping with us!",
        targetSegment: "Regular",
        templateName: "thank_you",
        templateLanguage: "en_US",
        placeholderConfig: null,
        scheduledAt: new Date(),
        status: "scheduled",
      },
    });

    await processWhatsAppBroadcast(broadcast);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const template = sentPayload(fetchSpy.mock.calls[0] as [unknown, RequestInit]).template;
    expect(template.name).toBe("thank_you");
    expect(template.components).toBeUndefined();
  });
});
