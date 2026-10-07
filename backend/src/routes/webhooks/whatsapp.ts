import { Router } from "express";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { phoneLookupHashes, normalizePhone } from "../../lib/piiCrypto";
import { isOptOutMessage, recordConsentTransition } from "../../lib/consent";
import { isWhatsAppMessageId, safeMetaError } from "../../lib/whatsappDiagnostics";

// Meta's WhatsApp Cloud API webhook — the "Callback URL" Meta's app
// dashboard (WhatsApp > Configuration) requires before it'll let you finish
// connecting a phone number. Two jobs:
//  - GET: the one-time verification handshake Meta performs the moment you
//    save the Callback URL + Verify Token in its dashboard — echo back
//    hub.challenge if hub.verify_token matches ours, else reject.
//  - POST: real event deliveries afterward (inbound messages, message
//    status updates). Meta signs every POST body with X-Hub-Signature-256
//    (HMAC-SHA256 over the raw payload, keyed by the Meta App Secret from
//    App Dashboard > Settings > Basic) — verified below against
//    WHATSAPP_APP_SECRET before anything in the body is trusted. Requires
//    the *raw* request bytes (see app.ts's express.raw() mount for this
//    route, same pattern as webhooks/razorpay.ts) — re-serializing a
//    parsed JSON body would produce a different signature and always fail.
const router = Router();

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedHex = signatureHeader.slice("sha256=".length);
  // Buffer.from on a malformed (non-hex, wrong-length) header would throw
  // or silently truncate — guard the shape before handing both sides to
  // timingSafeEqual, which itself throws on a length mismatch.
  if (!/^[0-9a-f]+$/i.test(providedHex) || providedHex.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(providedHex, "hex"));
}

type InboundMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
};

type StatusUpdate = {
  id?: unknown;
  status: string; // sent | delivered | read | failed
  errors?: unknown;
};

type ChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: InboundMessage[];
  statuses?: StatusUpdate[];
};

function bodyFor(message: InboundMessage): string {
  if (message.type === "text" && message.text?.body) return message.text.body;
  // Media/interactive/location/etc. — not yet parsed into a rendered body,
  // but still recorded (rather than dropped) so the conversation thread
  // stays complete and the tenant can see *something* arrived.
  return `[unsupported message type: ${message.type}]`;
}

async function findTenantIdForPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const cred = await prisma.integrationCredential.findFirst({
    where: { provider: "WHATSAPP", externalId: phoneNumberId },
    select: { tenantId: true },
  });
  return cred?.tenantId ?? null;
}

// Unconditional, server-side STOP/unsubscribe handling — runs on every
// inbound text message regardless of what any campaign or route later tries
// to do, per the consent model's whole point (see schema.prisma's
// ConsentEvent comment). Best-effort phone match against Customer, same
// limitation as routes/publicInquiries.ts's own auto-link: a WhatsApp
// contact who has replied but was never saved as a Customer has no
// consentStatus row to transition — harmless in practice, since every
// broadcast recipient query (jobs/scheduler.ts) is Customer-model-driven
// already, so a non-Customer phone number was never reachable by a
// broadcast in the first place.
async function maybeHandleOptOut(tenantId: string, from: string, body: string, tx: Prisma.TransactionClient): Promise<void> {
  if (!isOptOutMessage(body)) return;

  const customers = await tx.customer.findMany({
    where: { tenantId, phoneHash: { in: phoneLookupHashes(from) } }, // tenant-scoped
    select: { id: true, consentStatus: true },
  });
  // Phone hashes are indexed but not unique. Imports may have created more
  // than one record for this number; none may remain eligible after STOP.
  for (const customer of customers) {
    await recordConsentTransition({
      tenantId,
      customerId: customer.id,
      previousState: customer.consentStatus as "UNKNOWN" | "OPTED_IN" | "OPTED_OUT",
      newState: "OPTED_OUT",
      source: "CUSTOMER_REPLY",
    }, tx);
  }
}

async function processInboundMessage(tenantId: string, value: ChangeValue, message: InboundMessage) {
  // Consent, message persistence, and its idempotency marker commit together.
  // A failure rolls back everything so Meta can retry the same WAMID; a
  // successful duplicate returns before applying consent again.
  await prisma.$transaction(async (tx) => {
    // Idempotency: Meta redelivers on anything other than a fast 2xx, and can
    // send a genuine duplicate independent of that too. Check before writing.
    const existing = await tx.message.findFirst({
      where: { tenantId, externalId: message.id },
      select: { id: true },
    });
    if (existing) return;

    if (message.type === "text" && message.text?.body) {
      await maybeHandleOptOut(tenantId, message.from, message.text.body, tx);
    }

    const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;

    const canonicalHandle = normalizePhone(message.from);
    const legacyConversation = await tx.conversation.findFirst({
      where: { tenantId, channel: "WHATSAPP", contactHandle: { in: [canonicalHandle, `+${canonicalHandle}`] } },
      select: { contactHandle: true },
    });
    const contactHandle = legacyConversation?.contactHandle ?? canonicalHandle;

    const conversation = await tx.conversation.upsert({
      where: { tenantId_channel_contactHandle: { tenantId, channel: "WHATSAPP", contactHandle } },
      create: { tenantId, channel: "WHATSAPP", contactHandle, contactName },
      // Keep the existing contactName once one's been recorded (e.g. set by
      // a future "start new conversation" flow) rather than letting a later
      // inbound event with no profile name blank it out.
      update: { contactName: contactName ?? undefined, lastMessageAt: new Date() },
    });

    await tx.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: "INBOUND",
        body: bodyFor(message),
        status: "sent",
        externalId: message.id,
      },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  }, { isolationLevel: "Serializable" });
}

const VALID_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

async function processStatusUpdate(tenantId: string, statusUpdate: StatusUpdate) {
  // Signed JSON still needs runtime validation. Keep opaque IDs unchanged;
  // undefined/null filters would otherwise update unrelated tenant records.
  if (!isWhatsAppMessageId(statusUpdate?.id)) {
    logger.warn({ event: "whatsapp.receipt_ignored", tenantId, category: "INVALID_MESSAGE_ID" }, "WhatsApp receipt ignored");
    return;
  }
  const externalId = statusUpdate.id;
  if (!VALID_STATUSES.has(statusUpdate.status)) return;
  const status = statusUpdate.status;
  const failure = safeMetaError(Array.isArray(statusUpdate.errors) ? statusUpdate.errors[0] : undefined);
  const counts = await prisma.$transaction(async tx => {
    const where = { tenantId, externalId };
    const recipientCount = await tx.broadcastRecipient.count({ where });
    const messageCount = await tx.message.count({ where });
    // Delivery/read supersede a previously reported failure. A later weaker
    // event cannot erase stronger factual evidence or introduce contradiction.
    if (status === "delivered" || status === "read") {
      await tx.broadcastRecipient.updateMany({ where: { ...where, deliveredAt: null }, data: { deliveredAt: new Date(), failedAt: null, failureCode: null, failureCategory: null } });
      if (status === "read") await tx.broadcastRecipient.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date(), failedAt: null, failureCode: null, failureCategory: null } });
    } else if (status === "failed") {
      await tx.broadcastRecipient.updateMany({ where: { ...where, deliveredAt: null, readAt: null, failedAt: null }, data: { failedAt: new Date(), failureCode: failure.failureCode ?? null, failureCategory: "META_DELIVERY_FAILED" } });
    }
    await tx.message.updateMany({
      where: { ...where, ...(status === "read" ? {} : {
        status: { notIn: status === "delivered" ? ["read"] : status === "sent" ? ["delivered", "read", "failed"] : ["delivered", "read"] },
      }) },
      data: { status },
    });
    return { recipientCount, messageCount };
  });
  logger.info({ event: "whatsapp.receipt", tenantId, externalId, status, ...counts, ...(status === "failed" ? { failureCode: failure.failureCode, category: "META_DELIVERY_FAILED" } : {}), matched: counts.recipientCount + counts.messageCount > 0 }, "Signed WhatsApp receipt processed");
}

router.post("/", async (req, res) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Fail closed, same as webhooks/razorpay.ts: accepting unsigned events
    // because we forgot to configure the secret is worse than a loud 500 —
    // the whole point of this check is that Meta's servers are the only
    // party who should be able to write into a tenant's message history.
    logger.error("WhatsApp webhook received but WHATSAPP_APP_SECRET is not configured");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const rawBody = req.body; // Buffer — see express.raw() mount in app.ts
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Missing body" });
    return;
  }
  const signature = req.header("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, appSecret)) {
    logger.warn("WhatsApp webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event: { entry?: Array<{ changes?: Array<{ value?: ChangeValue }> }> };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  try {
    for (const entry of event.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!value || !phoneNumberId) continue;

        const tenantId = await findTenantIdForPhoneNumberId(phoneNumberId);
        if (!tenantId) {
          // A real Meta event for a phone_number_id no tenant has
          // connected here (stale subscription, disconnected tenant,
          // wrong app) — nothing to do, and nothing Meta should retry.
          logger.warn({ phoneNumberId }, "WhatsApp webhook event for unknown phone_number_id");
          continue;
        }

        for (const message of value.messages ?? []) {
          await processInboundMessage(tenantId, value, message);
        }
        for (const statusUpdate of value.statuses ?? []) {
          await processStatusUpdate(tenantId, statusUpdate);
        }
      }
    }
  } catch (err) {
    // An unexpected failure partway through (DB hiccup, etc.) — 500 so
    // Meta retries the whole delivery; processInboundMessage's idempotency
    // check above means anything already-written on this attempt is safely
    // skipped on the retry rather than duplicated.
    // Prisma/runtime exception text may include inbound PII. Keep diagnostics
    // categorical rather than serializing the exception or webhook payload.
    logger.error({ event: "whatsapp.webhook_error", category: "PROCESSING_ERROR" }, "WhatsApp webhook processing failed");
    res.status(500).json({ error: "Processing failed" });
    return;
  }

  res.sendStatus(200);
});

export default router;
