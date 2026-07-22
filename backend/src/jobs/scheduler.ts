import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { sendWhatsAppMessage } from "../integrations/whatsapp";
import { publishInstagramPost } from "../integrations/instagram";
import { publishFacebookPost } from "../integrations/facebook";
import { decryptField } from "../lib/piiCrypto";
import { logAccess } from "../lib/accessLog";
import { checkUsageLimit, incrementUsage } from "../lib/entitlements";

function applyTemplate(template: string, name: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name);
}

function toAbsoluteMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const base = process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return `${base}${mediaUrl}`;
}

async function processWhatsAppBroadcast(content: {
  id: string;
  tenantId: string;
  caption: string | null;
  targetSegment: string | null;
  targetCustomerId: string | null;
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
    await sendWhatsAppMessage(content.tenantId, phone, applyTemplate(content.caption ?? "", customer.name));
  }
  await incrementUsage(content.tenantId, "WHATSAPP_MESSAGES", sendable.length);

  await prisma.scheduledContent.update({
    where: { id: content.id },
    data: quotaNote
      ? { status: "failed", errorMessage: quotaNote, publishedAt: new Date() }
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
