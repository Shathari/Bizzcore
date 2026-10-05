import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { app, createTenantWithAdmin } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";

const APP_SECRET = "test-whatsapp-app-secret";

function signatureFor(bodyStr: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(bodyStr, "utf8")).digest("hex");
}

// Sends a raw, signed POST — mirrors exactly what app.ts's
// express.raw({ type: "application/json" }) mount expects: Content-Type
// set to application/json BEFORE .send() with a pre-serialized string, so
// supertest doesn't re-JSON.stringify (and thus reformat) the body out from
// under the signature computed over it.
function postWebhookEvent(payload: unknown, secret: string | null = APP_SECRET) {
  const bodyStr = JSON.stringify(payload);
  const req = request(app).post("/api/webhooks/whatsapp").set("Content-Type", "application/json");
  if (secret) req.set("X-Hub-Signature-256", signatureFor(bodyStr, secret));
  return req.send(bodyStr);
}

async function saveWhatsAppCredential(tenantId: string, phoneNumberId: string, accessToken = "wa-token") {
  return prisma.integrationCredential.create({
    data: {
      tenantId,
      provider: "WHATSAPP",
      encryptedPayload: encrypt(JSON.stringify({ phoneNumberId, accessToken })),
      externalId: phoneNumberId,
    },
  });
}

function messageEvent(phoneNumberId: string, from: string, body: string, waMessageId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "15550001111" },
              contacts: [{ profile: { name: "Priya Sharma" }, wa_id: from }],
              messages: [{ from, id: waMessageId, timestamp: "1700000000", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function statusEvent(phoneNumberId: string, waMessageId: string, status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "15550001111" },
              statuses: [{ id: waMessageId, status, timestamp: "1700000001", recipient_id: "919800000099" }],
            },
          },
        ],
      },
    ],
  };
}

describe("whatsapp webhook: GET verification handshake", () => {
  const ORIGINAL = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  beforeEach(() => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "correct-verify-token";
  });
  afterEach(() => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = ORIGINAL;
  });

  it("echoes hub.challenge when mode+token match", async () => {
    const res = await request(app)
      .get("/api/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "correct-verify-token", "hub.challenge": "12345" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("rejects a wrong verify token with 403", async () => {
    const res = await request(app)
      .get("/api/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong-token", "hub.challenge": "12345" });
    expect(res.status).toBe(403);
  });
});

describe("whatsapp webhook: POST signature verification", () => {
  const ORIGINAL = process.env.WHATSAPP_APP_SECRET;
  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = ORIGINAL;
  });

  it("fails closed with 500 when WHATSAPP_APP_SECRET isn't configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const res = await postWebhookEvent(messageEvent("phone-1", "919800000001", "hi", "wamid.1"));
    expect(res.status).toBe(500);
  });

  it("rejects a request with no signature header", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    const res = await postWebhookEvent(messageEvent("phone-1", "919800000001", "hi", "wamid.1"), null);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid/forged signature", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    const res = await postWebhookEvent(messageEvent("phone-1", "919800000001", "hi", "wamid.1"), "wrong-secret");
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed request", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    const res = await postWebhookEvent(messageEvent("phone-unknown", "919800000001", "hi", "wamid.unknown-1"));
    expect(res.status).toBe(200);
  });
});

describe("whatsapp webhook: inbound message processing", () => {
  const ORIGINAL = process.env.WHATSAPP_APP_SECRET;
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  });
  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = ORIGINAL;
  });

  it("creates a Conversation + inbound Message for a known phone_number_id, stamped with the WAMID", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, "phone-a1");

    const res = await postWebhookEvent(messageEvent("phone-a1", "919800000010", "Do you have this in blue?", "wamid.a1"));
    expect(res.status).toBe(200);

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "919800000010" },
      include: { messages: true },
    });
    expect(conversation).not.toBeNull();
    expect(conversation!.contactName).toBe("Priya Sharma");
    expect(conversation!.messages).toHaveLength(1);
    expect(conversation!.messages[0]).toMatchObject({
      direction: "INBOUND",
      body: "Do you have this in blue?",
      externalId: "wamid.a1",
      tenantId: tenant.id,
    });
  });

  it("routes an event to the correct tenant only — never a lookalike tenant using a different phone_number_id", async () => {
    const { tenant: tenantA } = await createTenantWithAdmin("Tenant A");
    const { tenant: tenantB } = await createTenantWithAdmin("Tenant B");
    await saveWhatsAppCredential(tenantA.id, "phone-a2");
    await saveWhatsAppCredential(tenantB.id, "phone-b2");

    await postWebhookEvent(messageEvent("phone-a2", "919800000011", "hello from A's customer", "wamid.a2"));

    const convosA = await prisma.conversation.findMany({ where: { tenantId: tenantA.id, channel: "WHATSAPP" } });
    const convosB = await prisma.conversation.findMany({ where: { tenantId: tenantB.id, channel: "WHATSAPP" } });
    expect(convosA).toHaveLength(1);
    expect(convosB).toHaveLength(0);
  });

  it("is idempotent — redelivering the same WAMID does not create a duplicate Message", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, "phone-a3");
    const payload = messageEvent("phone-a3", "919800000012", "hi again", "wamid.a3-dup");

    await postWebhookEvent(payload);
    await postWebhookEvent(payload); // Meta-style redelivery

    const messages = await prisma.message.findMany({ where: { tenantId: tenant.id, externalId: "wamid.a3-dup" } });
    expect(messages).toHaveLength(1);
  });

  it("reuses the same Conversation across multiple inbound messages from the same contact", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, "phone-a4");

    await postWebhookEvent(messageEvent("phone-a4", "919800000013", "first message", "wamid.a4-1"));
    await postWebhookEvent(messageEvent("phone-a4", "919800000013", "second message", "wamid.a4-2"));

    const conversations = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "919800000013" },
    });
    expect(conversations).toHaveLength(1);
    const messages = await prisma.message.findMany({ where: { conversationId: conversations[0].id } });
    expect(messages).toHaveLength(2);
  });

  it("acknowledges 200 for an event whose phone_number_id matches no connected tenant, without writing anything", async () => {
    const res = await postWebhookEvent(messageEvent("phone-nobody-owns", "919800000014", "hi", "wamid.orphan"));
    expect(res.status).toBe(200);
    const messages = await prisma.message.findMany({ where: { externalId: "wamid.orphan" } });
    expect(messages).toHaveLength(0);
  });
});

describe("whatsapp webhook: status update processing", () => {
  const ORIGINAL = process.env.WHATSAPP_APP_SECRET;
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  });
  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = ORIGINAL;
  });

  it("updates an existing OUTBOUND Message's status when a matching WAMID status event arrives", async () => {
    const { tenant } = await createTenantWithAdmin();
    // The suite shares one database; template tests also use phone-s1.
    await saveWhatsAppCredential(tenant.id, "webhook-status-s1");

    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "919800000020" },
    });
    const message = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        body: "Your order is confirmed",
        status: "sent",
        externalId: "wamid.s1",
      },
    });

    const res = await postWebhookEvent(statusEvent("webhook-status-s1", "wamid.s1", "delivered"));
    expect(res.status).toBe(200);

    const updated = await prisma.message.findUnique({ where: { id: message.id } });
    expect(updated!.status).toBe("delivered");
  });

  it("is a safe no-op when the status event's WAMID doesn't match any stored Message", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, "phone-s2");

    const res = await postWebhookEvent(statusEvent("phone-s2", "wamid.never-sent", "read"));
    expect(res.status).toBe(200);
  });
});
