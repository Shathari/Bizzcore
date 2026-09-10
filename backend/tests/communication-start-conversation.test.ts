import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";

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

describe("communication: POST /conversations (start a new conversation)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/communication/conversations")
      .send({ channel: "WHATSAPP", contactHandle: "+919800000030", body: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects WEBSITE_CHAT — there's no live widget to originate a thread on", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WEBSITE_CHAT", contactHandle: "anything", body: "hi" });
    expect(res.status).toBe(400);
  });

  it("rejects a blank message body", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000031", body: "   " });
    expect(res.status).toBe(400);
  });

  it("creates a new Conversation + OUTBOUND Message in mock mode when no WhatsApp credential is configured", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000032", contactName: "New Customer", body: "Welcome!" });

    expect(res.status).toBe(201);
    expect(res.body.delivery).toEqual({ delivered: false, mode: "mock" });
    expect(res.body.conversation.contactName).toBe("New Customer");
    expect(res.body.message).toMatchObject({ direction: "OUTBOUND", body: "Welcome!", status: "sent" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const stored = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000032" },
    });
    expect(stored).not.toBeNull();
  });

  it("sends a real Graph API call and stores the returned WAMID when the tenant has WhatsApp connected", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-live-1", accessToken: "wa-token-1" });
    const cookie = await loginAs(admin.email);

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.new-convo-1" }] }),
    } as Response);

    const res = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000033", body: "First contact" });

    expect(res.status).toBe(201);
    expect(res.body.delivery).toMatchObject({ delivered: true, mode: "live", externalId: "wamid.new-convo-1" });
    expect(res.body.message.externalId).toBe("wamid.new-convo-1");

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain("phone-live-1/messages");
  });

  it("normalizes a loosely-formatted WhatsApp number so it matches the same contact consistently", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+91 98000 00034", body: "hi" });

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000034" },
    });
    expect(conversations).toHaveLength(1);
  });

  it("reuses an existing conversation for the same contact instead of forking a duplicate", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const first = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000035", body: "first message" });
    const second = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000035", body: "second message" });

    expect(first.body.conversation.id).toBe(second.body.conversation.id);

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000035" },
    });
    expect(conversations).toHaveLength(1);
    const messages = await prisma.message.findMany({ where: { conversationId: conversations[0].id } });
    expect(messages).toHaveLength(2);
  });

  it("does not overwrite an already-known contactName with a blank one on a later message", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000036", contactName: "Kavya Iyer", body: "hi" });
    await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000036", body: "follow-up, no name given this time" });

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000036" },
    });
    expect(conversation!.contactName).toBe("Kavya Iyer");
  });

  it("blocks starting a WhatsApp conversation once the plan's monthly message limit is reached, without creating an orphan conversation", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    // Deliberately no grantPermissivePlan — a bare tenant has no plan, so
    // WHATSAPP_MESSAGES usage is blocked from the very first attempt (same
    // "not_included" path exercised by tests/entitlement-enforcement.test.ts).
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookie)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000037", body: "hi" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_INCLUDED");

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000037" },
    });
    expect(conversation).toBeNull();
  });

  it("never lets tenant A's new conversation become visible to tenant B", async () => {
    const { tenant: tenantA, admin: adminA } = await createTenantWithAdmin("Tenant A6");
    const { tenant: tenantB } = await createTenantWithAdmin("Tenant B6");
    await grantPermissivePlan(tenantA.id);
    const cookieA = await loginAs(adminA.email);

    await request(app)
      .post("/api/communication/conversations")
      .set("Cookie", cookieA)
      .send({ channel: "WHATSAPP", contactHandle: "+919800000038", body: "hi" });

    const leaked = await prisma.conversation.findFirst({
      where: { tenantId: tenantB.id, channel: "WHATSAPP", contactHandle: "+919800000038" },
    });
    expect(leaked).toBeNull();
  });
});
