import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { app, createTenantWithAdmin, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";
import { hashForLookup, normalizePhone, phoneLookupHashes } from "../src/lib/piiCrypto";
import * as consent from "../src/lib/consent";

const secret = "consent-regression-secret";
function stopEvent(phoneId: string, wamid: string) {
  return { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneId },
    messages: [{ from: "919800000077", id: wamid, type: "text", text: { body: "STOP" } }],
  } }] }] };
}
function postEvent(event: unknown) {
  const body = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return request(app).post("/api/webhooks/whatsapp")
    .set("Content-Type", "application/json").set("X-Hub-Signature-256", `sha256=${signature}`).send(body);
}
async function fixture(legacy = false) {
  const { tenant } = await createTenantWithAdmin();
  const customer = await createTestCustomer(tenant.id, {
    phone: "+919800000077", consentStatus: "OPTED_IN",
    ...(legacy ? { phoneHash: hashForLookup("+919800000077") } : {}),
  });
  const phoneId = `phone-${tenant.id}`;
  await prisma.integrationCredential.create({ data: {
    tenantId: tenant.id, provider: "WHATSAPP", externalId: phoneId,
    encryptedPayload: encrypt(JSON.stringify({ phoneNumberId: phoneId, accessToken: "token" })),
  } });
  return { tenant, customer, event: stopEvent(phoneId, `wamid.${tenant.id}`) };
}

describe("marketing consent regressions", () => {
  const originalSecret = process.env.WHATSAPP_APP_SECRET;
  beforeEach(() => { process.env.WHATSAPP_APP_SECRET = secret; });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = originalSecret;
  });

  it("canonicalizes international notation without inventing a country code", () => {
    expect(normalizePhone("+91 98000-00077")).toBe("919800000077");
    expect(normalizePhone("919800000077")).toBe("919800000077");
    expect(normalizePhone("9800000077")).toBe("9800000077");
    expect(phoneLookupHashes("+919800000077")).toEqual(phoneLookupHashes("919800000077"));
  });

  it.each([false, true])("STOP finds plus-format encrypted phones (legacy hash=%s), with one event on duplicates", async (legacy) => {
    const { tenant, customer, event } = await fixture(legacy);
    const other = await createTenantWithAdmin();
    const otherCustomer = await createTestCustomer(other.tenant.id, { phone: "+919800000077", consentStatus: "OPTED_IN" });
    expect((await postEvent(event)).status).toBe(200);
    expect((await postEvent(event)).status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).consentStatus).toBe("OPTED_OUT");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomer.id } })).consentStatus).toBe("OPTED_IN");
    expect(await prisma.consentEvent.count({ where: { tenantId: tenant.id, customerId: customer.id } })).toBe(1);
    expect(await prisma.message.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  it("rolls back a failed consent update, retries STOP, and ignores subsequent duplicate delivery", async () => {
    const { tenant, customer, event } = await fixture();
    const originalTransition = consent.recordConsentTransition;
    vi.spyOn(consent, "recordConsentTransition").mockImplementationOnce(async (input, tx) => {
      await originalTransition(input, tx);
      throw new Error("Simulated consent transaction failure");
    });
    expect((await postEvent(event)).status).toBe(500);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).consentStatus).toBe("OPTED_IN");
    expect(await prisma.consentEvent.count({ where: { customerId: customer.id } })).toBe(0);
    expect(await prisma.message.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect((await postEvent(event)).status).toBe(200);
    expect((await postEvent(event)).status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).consentStatus).toBe("OPTED_OUT");
    expect(await prisma.consentEvent.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.message.count({ where: { tenantId: tenant.id } })).toBe(1);
    // A delayed duplicate must not undo a later, explicit opt-in.
    await originalTransition({ tenantId: tenant.id, customerId: customer.id, previousState: "OPTED_OUT", newState: "OPTED_IN", source: "CUSTOMER_SELF_SERVICE" });
    expect((await postEvent(event)).status).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).consentStatus).toBe("OPTED_IN");
    expect(await prisma.consentEvent.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it("uses current state for history and refuses a cross-tenant transition", async () => {
    const { tenant, customer } = await fixture();
    const input = { tenantId: tenant.id, customerId: customer.id, previousState: "UNKNOWN" as const, newState: "OPTED_OUT" as const, source: "CUSTOMER_REPLY" as const };
    await consent.recordConsentTransition(input);
    await consent.recordConsentTransition(input);
    const events = await prisma.consentEvent.findMany({ where: { customerId: customer.id } });
    expect(events).toHaveLength(1);
    expect(events[0].previousState).toBe("OPTED_IN");
    const other = await createTenantWithAdmin();
    await expect(consent.recordConsentTransition({ ...input, tenantId: other.tenant.id, newState: "OPTED_IN" })).rejects.toThrow();
  });

  it("opts out every matching customer record when imports contain duplicate phone identities", async () => {
    const { tenant, customer, event } = await fixture();
    const duplicate = await createTestCustomer(tenant.id, {
      phone: "+919800000077", phoneHash: hashForLookup("+919800000077"), consentStatus: "OPTED_IN",
    });
    expect((await postEvent(event)).status).toBe(200);
    expect((await postEvent(event)).status).toBe(200);
    const customers = await prisma.customer.findMany({ where: { id: { in: [customer.id, duplicate.id] } } });
    expect(customers.map((c) => c.consentStatus)).toEqual(["OPTED_OUT", "OPTED_OUT"]);
    expect(await prisma.consentEvent.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  it("preserves legacy plus-format conversation history when STOP arrives without the plus", async () => {
    const { tenant, event } = await fixture(true);
    const conversation = await prisma.conversation.create({ data: {
      tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000077", contactName: "Saved contact",
    } });
    expect((await postEvent(event)).status).toBe(200);
    expect(await prisma.conversation.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });
});
