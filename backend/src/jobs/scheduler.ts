import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage, type WhatsAppResult } from "../integrations/whatsapp";
import { publishInstagramPost } from "../integrations/instagram";
import { publishFacebookPost } from "../integrations/facebook";
import { decryptField } from "../lib/piiCrypto";
import { logAccess } from "../lib/accessLog";
import { checkUsageLimit, incrementUsage } from "../lib/entitlements";
import { resolvePlaceholders, CUSTOMER_FIELD_OPTIONS, type PlaceholderMapping } from "../lib/whatsappPlaceholders";
import { recomputeInactiveCustomers } from "../lib/customerSegmentation";
import { logger } from "../lib/logger";
import { isWhatsAppMessageId } from "../lib/whatsappDiagnostics";

function applyTemplate(template: string, name: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name);
}

function toAbsoluteMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const base = process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return `${base}${mediaUrl}`;
}

// Exported for direct unit testing (tests/scheduler-whatsapp-broadcast.test.ts)
// — the cron job itself (startScheduler below) is what wires this to a real
// timer/DB poll in production; this function is the actual per-broadcast
// dispatch logic and is worth testing in isolation from that.
export async function processWhatsAppBroadcast(content: {
  id: string;
  tenantId: string;
  caption: string | null;
  targetSegment: string | null;
  targetCustomerId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  placeholderConfig: string | null;
}) {
  const context = { tenantId: content.tenantId, broadcastId: content.id };
  logger.info({ event: "whatsapp.broadcast_start", ...context }, "Broadcast dispatch started");
  // Marketing requires explicit opt-in, for individual and segment audiences.
  // Recheck below immediately before every send; this snapshot is not authority.
  const recipients = content.targetCustomerId
    ? await prisma.customer.findMany({
        where: { id: content.targetCustomerId, tenantId: content.tenantId, consentStatus: "OPTED_IN" }, // tenant-scoped
      })
    : await prisma.customer.findMany({
        where: { tenantId: content.tenantId, segment: content.targetSegment ?? undefined, consentStatus: "OPTED_IN" }, // tenant-scoped
      });

  if (recipients.length === 0) {
    logger.info({ event: "whatsapp.broadcast_complete", ...context, accepted: 0, category: "NO_ELIGIBLE_RECIPIENTS" }, "Broadcast dispatch completed");
    await prisma.scheduledContent.update({
      where: { id: content.id },
      data: { status: "failed", errorMessage: "No matching recipients found" },
    });
    return;
  }

  // Segment size isn't known until send time (a segment can grow/shrink
  // between scheduling and dispatch), so the WHATSAPP_MESSAGES budget is
  // only checked here, not at broadcast-creation time. If the full
  // recipient list doesn't fit the remaining monthly budget, send to as
  // many as do fit rather than either silently over-sending or dropping
  // the whole broadcast.
  const usageCheck = await checkUsageLimit(content.tenantId, "WHATSAPP_MESSAGES", recipients.length);
  const sendable = recipients;
  let sendBudget = recipients.length;
  let quotaNote: string | null = null;

  if (!usageCheck.allowed) {
    if (usageCheck.reason === "not_included") {
      logger.info({ event: "whatsapp.broadcast_complete", ...context, accepted: 0, category: "PLAN_NOT_INCLUDED" }, "Broadcast dispatch completed");
      await prisma.scheduledContent.update({
        where: { id: content.id },
        data: { status: "failed", errorMessage: "WhatsApp messaging isn't included in this business's current plan." },
      });
      return;
    }
    const remaining = Math.max(0, usageCheck.limit - usageCheck.used);
    if (remaining === 0) {
      logger.info({ event: "whatsapp.broadcast_complete", ...context, accepted: 0, category: "QUOTA_EXHAUSTED" }, "Broadcast dispatch completed");
      await prisma.scheduledContent.update({
        where: { id: content.id },
        data: {
          status: "failed",
          errorMessage: `Monthly WhatsApp message limit already reached (${usageCheck.used}/${usageCheck.limit}) — no messages sent.`,
        },
      });
      return;
    }
    sendBudget = remaining;
  }

  // placeholderConfig is only ever non-null in template mode (see
  // routes/communication.ts's POST /broadcasts) — parsed once, outside the
  // loop, since it's the same for every recipient; only its per-recipient
  // *resolution* (resolvePlaceholders below) varies.
  const placeholders: PlaceholderMapping[] = content.placeholderConfig ? JSON.parse(content.placeholderConfig) : [];
  const skipped: { customerId: string; field: string }[] = [];
  let sentCount = 0;
  let consentSkipped = 0;
  const deliveryFailures: string[] = [];

  for (const customer of sendable) {
    if (sentCount >= sendBudget) {
      quotaNote = `Sent to ${sentCount} of ${recipients.length} recipients — monthly WhatsApp message limit reached partway through.`;
      break;
    }
    // JIT-decrypt right before the send, one customer at a time — never
    // batch-decrypt the recipient list up front. Logged as a system action
    // (actorId null: this runs off the cron scheduler, not a user request).
    const phone = decryptField(customer.phone);
    await logAccess({
      tenantId: content.tenantId,
      actorId: null,
      customerId: customer.id,
      field: "phone",
      reason: "broadcast_send",
    });

    let bodyParams: string[] | undefined;
    if (content.templateName && content.templateLanguage) {
      const resolved = resolvePlaceholders(placeholders, {
        name: customer.name,
        segment: customer.segment,
        totalSpent: customer.totalSpent,
        lastPurchase: customer.lastPurchase,
        decryptedPhone: phone,
      });
      if (!resolved.ok) {
        // Skip + log, never fabricate a value or send a broken message —
        // this recipient simply doesn't get this broadcast; every other
        // recipient is unaffected.
        skipped.push({ customerId: customer.id, field: resolved.missingField });
        logger.info({ event: "whatsapp.recipient_skip", ...context, customerId: customer.id, category: "MISSING_TEMPLATE_FIELD", missingField: resolved.missingField }, "Broadcast recipient skipped");
        continue;
      }
      bodyParams = resolved.params.length > 0 ? resolved.params : undefined;
    }
    // Indexed identity lookup, one small read per attempted recipient. Never
    // trust the audience snapshot if the customer was deleted or opted out.
    const current = await prisma.customer.findFirst({
      where: { id: customer.id, tenantId: content.tenantId },
      select: { consentStatus: true },
    });
    if (current?.consentStatus !== "OPTED_IN") {
      logger.info({ event: "whatsapp.recipient_skip", ...context, customerId: customer.id, category: "NO_CURRENT_OPT_IN" }, "Broadcast recipient skipped");
      consentSkipped++;
      continue;
    }
    let result: WhatsAppResult;
    logger.info({ event: "whatsapp.recipient_attempt", ...context, customerId: customer.id, templateName: content.templateName, templateLanguage: content.templateLanguage }, "Broadcast recipient send starting");
    if (content.templateName && content.templateLanguage) {
      result = await sendWhatsAppTemplateMessage(
        content.tenantId,
        phone,
        content.templateName,
        content.templateLanguage,
        bodyParams
      );
    } else {
      result = await sendWhatsAppMessage(content.tenantId, phone, applyTemplate(content.caption ?? "", customer.name));
    }
    logger.info({ event: "whatsapp.recipient_result", ...context, customerId: customer.id, accepted: result.accepted, category: result.category, externalId: result.externalId, httpStatus: result.httpStatus, failureCode: result.failureCode }, "Broadcast recipient send completed");
    if (result.mode !== "live" || !result.accepted || !isWhatsAppMessageId(result.externalId)) {
      deliveryFailures.push(result.category ?? "WHATSAPP_NOT_ACCEPTED");
      continue;
    }
    sentCount++;
    // Preserve successful-send accounting even if evidence persistence fails.
    await incrementUsage(content.tenantId, "WHATSAPP_MESSAGES", 1);
    // Evidence is recorded only after live API acceptance, never for mocks,
    // failed sends or consent-skipped recipients. Retries cannot duplicate it.
    await prisma.broadcastRecipient.upsert({
      where: { tenantId_broadcastId_customerId: { tenantId: content.tenantId, broadcastId: content.id, customerId: customer.id } },
      create: { tenantId: content.tenantId, broadcastId: content.id, customerId: customer.id, externalId: result.externalId },
      update: {},
    });
  }
  // Only actually-sent messages count against the plan's monthly budget —
  // a recipient skipped for missing data was never sent, so it shouldn't
  // consume quota either.

  const notes: string[] = [];
  if (consentSkipped) notes.push(`${consentSkipped} recipients skipped: no current marketing opt-in`);
  if (deliveryFailures.length) notes.push(`${deliveryFailures.length} sends unsuccessful: ${deliveryFailures[0]}`);
  if (quotaNote) notes.push(quotaNote);
  if (skipped.length > 0) {
    const byField = new Map<string, number>();
    for (const s of skipped) byField.set(s.field, (byField.get(s.field) ?? 0) + 1);
    const breakdown = [...byField.entries()]
      .map(([field, count]) => `${count} missing ${CUSTOMER_FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field}`)
      .join(", ");
    notes.push(`${skipped.length} of ${sendable.length} recipients skipped: ${breakdown}`);
  }

  await prisma.scheduledContent.update({
    where: { id: content.id },
    data:
      notes.length > 0
        ? { status: "failed", errorMessage: notes.join(" — "), publishedAt: new Date() }
        : { status: "published", publishedAt: new Date() },
  });
  logger.info({ event: "whatsapp.broadcast_complete", ...context, accepted: sentCount, unsuccessful: deliveryFailures.length, consentSkipped, templateSkipped: skipped.length, status: notes.length ? "failed" : "published" }, "Broadcast dispatch completed");
}

async function processSocialPost(content: {
  id: string;
  tenantId: string;
  channel: string;
  postType: string | null;
  caption: string | null;
  mediaUrl: string | null;
}) {
  const absoluteMediaUrl = toAbsoluteMediaUrl(content.mediaUrl);
  const result =
    content.channel === "FACEBOOK"
      ? await publishFacebookPost(content.tenantId, absoluteMediaUrl, content.caption ?? "")
      : await publishInstagramPost(content.tenantId, absoluteMediaUrl, content.caption ?? "", content.postType ?? "POST");

  if (result.mode === "live" && !result.delivered) {
    await prisma.scheduledContent.update({
      where: { id: content.id },
      data: { status: "failed", errorMessage: result.error ?? "Delivery failed" },
    });
    return;
  }

  // Mock-mode posts are still marked "published" — per spec, they "stay
  // visible locally for review until real Meta credentials are connected."
  // The page-level mock/live banner (GET /api/social/integration-status)
  // is what tells the tenant these weren't actually delivered.
  await prisma.scheduledContent.update({
    where: { id: content.id },
    data: { status: "published", publishedAt: new Date() },
  });
}

// Checks for due ScheduledContent every minute, per spec — both
// WHATSAPP_BROADCAST (Communication Center) and SOCIAL_POST (Social Media
// Manager) kinds.
export function startScheduler(): void {
  cron.schedule("* * * * *", async () => {
    const due = await prisma.scheduledContent.findMany({
      where: {
        status: "scheduled",
        scheduledAt: { lte: new Date() },
        kind: { in: ["WHATSAPP_BROADCAST", "SOCIAL_POST"] },
      },
    });

    for (const item of due) {
      try {
        if (item.kind === "WHATSAPP_BROADCAST") {
          await processWhatsAppBroadcast(item);
        } else {
          await processSocialPost(item);
        }
      } catch (err) {
        logger.error({ event: "scheduler.dispatch_failed", tenantId: item.tenantId, broadcastId: item.id, category: "DISPATCH_ERROR" }, "Scheduled dispatch failed");
        await prisma.scheduledContent.update({
          where: { id: item.id },
          data: { status: "failed", errorMessage: item.kind === "WHATSAPP_BROADCAST" ? "DISPATCH_ERROR" : err instanceof Error ? err.message : "Unknown error" },
        });
      }
    }
  });

  // Once daily (03:00 UTC) — inactivity status doesn't need minute-level
  // freshness like broadcast dispatch does, and re-tagging every customer
  // on every tenant is real query volume worth keeping off the per-minute
  // loop above. See lib/customerSegmentation.ts for the actual logic.
  cron.schedule("0 3 * * *", async () => {
    try {
      await recomputeInactiveCustomers();
    } catch (err) {
      console.error("[scheduler] recomputeInactiveCustomers failed:", err);
    }
  });
}
