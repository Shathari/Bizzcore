import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage } from "../integrations/whatsapp";
import { publishInstagramPost } from "../integrations/instagram";
import { publishFacebookPost } from "../integrations/facebook";
import { decryptField } from "../lib/piiCrypto";
import { logAccess } from "../lib/accessLog";
import { checkUsageLimit, incrementUsage } from "../lib/entitlements";
import { resolvePlaceholders, CUSTOMER_FIELD_OPTIONS, type PlaceholderMapping } from "../lib/whatsappPlaceholders";

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
  const recipients = content.targetCustomerId
    ? await prisma.customer.findMany({ where: { id: content.targetCustomerId, tenantId: content.tenantId } }) // tenant-scoped
    : await prisma.customer.findMany({
        where: { tenantId: content.tenantId, segment: content.targetSegment ?? undefined }, // tenant-scoped
      });

  if (recipients.length === 0) {
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
  let sendable = recipients;
  let quotaNote: string | null = null;

  if (!usageCheck.allowed) {
    if (usageCheck.reason === "not_included") {
      await prisma.scheduledContent.update({
        where: { id: content.id },
        data: { status: "failed", errorMessage: "WhatsApp messaging isn't included in this business's current plan." },
      });
      return;
    }
    const remaining = Math.max(0, usageCheck.limit - usageCheck.used);
    if (remaining === 0) {
      await prisma.scheduledContent.update({
        where: { id: content.id },
        data: {
          status: "failed",
          errorMessage: `Monthly WhatsApp message limit already reached (${usageCheck.used}/${usageCheck.limit}) — no messages sent.`,
        },
      });
      return;
    }
    sendable = recipients.slice(0, remaining);
    quotaNote = `Sent to ${sendable.length} of ${recipients.length} recipients — monthly WhatsApp message limit reached partway through.`;
  }

  // placeholderConfig is only ever non-null in template mode (see
  // routes/communication.ts's POST /broadcasts) — parsed once, outside the
  // loop, since it's the same for every recipient; only its per-recipient
  // *resolution* (resolvePlaceholders below) varies.
  const placeholders: PlaceholderMapping[] = content.placeholderConfig ? JSON.parse(content.placeholderConfig) : [];
  const skipped: { customerId: string; field: string }[] = [];
  let sentCount = 0;

  for (const customer of sendable) {
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
        console.log(
          `[broadcast:skip] tenant=${content.tenantId} broadcast=${content.id} customer=${customer.id} missingField=${resolved.missingField}`
        );
        continue;
      }
      await sendWhatsAppTemplateMessage(
        content.tenantId,
        phone,
        content.templateName,
        content.templateLanguage,
        resolved.params.length > 0 ? resolved.params : undefined
      );
    } else {
      await sendWhatsAppMessage(content.tenantId, phone, applyTemplate(content.caption ?? "", customer.name));
    }
    sentCount++;
  }
  // Only actually-sent messages count against the plan's monthly budget —
  // a recipient skipped for missing data was never sent, so it shouldn't
  // consume quota either.
  await incrementUsage(content.tenantId, "WHATSAPP_MESSAGES", sentCount);

  const notes: string[] = [];
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
        await prisma.scheduledContent.update({
          where: { id: item.id },
          data: { status: "failed", errorMessage: err instanceof Error ? err.message : "Unknown error" },
        });
      }
    }
  });
}
