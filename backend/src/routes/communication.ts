import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { sendWhatsAppMessage } from "../integrations/whatsapp";
import { sendInstagramDirectMessage } from "../integrations/instagram";
import { sendFacebookDirectMessage } from "../integrations/facebook";
import { checkAndIncrementUsage } from "../lib/entitlements";
import { isValidCategory } from "../lib/customerCategories";
import { normalizePhone } from "../lib/piiCrypto";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const CHANNELS = ["WHATSAPP", "WEBSITE_CHAT", "INSTAGRAM_DM", "FACEBOOK_DM"] as const;
// Channels a tenant can actually originate a message on from this app —
// WEBSITE_CHAT is deliberately excluded, same as the reply route below:
// there's no live customer-facing chat widget, so there's no real
// recipient a "new" website-chat thread could ever reach.
const OUTBOUND_CHANNELS = ["WHATSAPP", "INSTAGRAM_DM", "FACEBOOK_DM"] as const;

type ChannelDelivery = { mode: "live" | "mock"; delivered: boolean; error?: string; externalId?: string } | null;

// Shared by the reply route and the start-new-conversation route below —
// one place to add a channel's adapter, instead of two copies of this
// dispatch drifting apart.
async function sendOnChannel(
  tenantId: string,
  channel: string,
  contactHandle: string | null,
  body: string
): Promise<ChannelDelivery> {
  if (!contactHandle) return null;
  if (channel === "WHATSAPP") return sendWhatsAppMessage(tenantId, contactHandle, body);
  if (channel === "INSTAGRAM_DM") return sendInstagramDirectMessage(tenantId, contactHandle, body);
  if (channel === "FACEBOOK_DM") return sendFacebookDirectMessage(tenantId, contactHandle, body);
  return null;
}

// A live send genuinely failing is worth surfacing as "failed" in history;
// mock mode still counts as "sent" from the tenant's workflow perspective
// (recorded, just not actually delivered to a real API yet).
function statusFor(delivery: ChannelDelivery): string {
  return delivery && !delivery.delivered && delivery.mode === "live" ? "failed" : "sent";
}

// --- Unified inbox -----------------------------------------------------

router.get("/conversations", async (req, res) => {
  const channelParam = req.query.channel;
  const channel =
    typeof channelParam === "string" && (CHANNELS as readonly string[]).includes(channelParam)
      ? channelParam
      : undefined;

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: req.tenantId, // tenant-scoped
      ...(channel ? { channel } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  res.json(
    conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      contactName: c.contactName,
      contactHandle: c.contactHandle,
      customerId: c.customerId,
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.messages[0]
        ? { body: c.messages[0].body, direction: c.messages[0].direction, sentAt: c.messages[0].sentAt }
        : null,
    }))
  );
});

const startConversationSchema = z.object({
  channel: z.enum(OUTBOUND_CHANNELS, { errorMap: () => ({ message: "Choose WhatsApp, Instagram, or Facebook" }) }),
  contactHandle: z.string().trim().min(1, "A phone number or handle is required"),
  contactName: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1, "Message can't be empty"),
});

// Starts a brand-new outbound thread — the missing piece the reply route
// above can't cover, since it only ever replies into a conversation that
// already exists. Without this, the only way a Conversation row ever came
// to exist was prisma/seed.ts's demo data or (as of the webhook work) an
// inbound message beating the tenant to the first contact.
router.post("/conversations", async (req, res) => {
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { channel, contactName, body } = parsed.data;
  // WhatsApp numbers are free-typed here (unlike Customer.phone, there's no
  // upstream form forcing a consistent shape) — normalize so "+91 98000
  // 00010" and "919800000010" land in the same Conversation instead of
  // silently forking into two threads for the same contact. Instagram/
  // Facebook handles/page-scoped ids aren't phone numbers, so they're only
  // trimmed (already done by the schema above).
  const contactHandle = channel === "WHATSAPP" ? normalizePhone(parsed.data.contactHandle) : parsed.data.contactHandle;
  const tenantId = req.tenantId!;

  // Same metering as the reply route below — see its comment for why only
  // WhatsApp is checked here.
  if (channel === "WHATSAPP") {
    const usage = await checkAndIncrementUsage(tenantId, "WHATSAPP_MESSAGES");
    if (!usage.allowed) {
      res.status(403).json({
        error:
          usage.reason === "not_included"
            ? "Your current plan doesn't include WhatsApp messaging. Upgrade your plan to use it."
            : `You've reached your plan's monthly WhatsApp message limit (${usage.used}/${usage.limit}). Upgrade your plan, or wait for next month's reset.`,
        code: usage.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
        featureKey: "WHATSAPP_MESSAGES",
      });
      return;
    }
  }

  // Reuses whatever thread already exists for this contact — the same
  // identity key the inbound webhook upserts against (schema.prisma's
  // @@unique([tenantId, channel, contactHandle]) on Conversation) — rather
  // than erroring or forking a duplicate if the tenant "starts" a
  // conversation with someone who already messaged in, or who they've
  // already messaged before.
  const conversation = await prisma.conversation.upsert({
    where: { tenantId_channel_contactHandle: { tenantId, channel, contactHandle } },
    create: { tenantId, channel, contactHandle, contactName: contactName ?? null },
    update: contactName ? { contactName } : {},
  });

  const delivery = await sendOnChannel(tenantId, channel, contactHandle, body);
  const status = statusFor(delivery);

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body,
      status,
      externalId: delivery?.externalId ?? null,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.sentAt } });

  res.status(201).json({ conversation, message, delivery });
});

router.get("/conversations/:id/messages", async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!conversation) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId: req.tenantId }, // tenant-scoped
    orderBy: { sentAt: "asc" },
  });
  res.json(messages);
});

const replySchema = z.object({ body: z.string().trim().min(1, "Message can't be empty") });

router.post("/conversations/:id/messages", async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!conversation) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const tenantId = req.tenantId!;

  // Only WHATSAPP is metered — WHATSAPP_MESSAGES is the only communication
  // key in the catalog with a real send path (see entitlement-enforcement
  // chat summary: EMAILS/SMS/PUSH_NOTIFICATIONS have no send functionality
  // at all in this build, and Instagram/Facebook DMs aren't in the catalog).
  // Checked before the delivery attempt: a real WhatsApp send is billed by
  // the provider per attempt regardless of delivery outcome, so a "failed"
  // status still spends a unit, same as a live send would.
  if (conversation.channel === "WHATSAPP") {
    const usage = await checkAndIncrementUsage(tenantId, "WHATSAPP_MESSAGES");
    if (!usage.allowed) {
      res.status(403).json({
        error:
          usage.reason === "not_included"
            ? "Your current plan doesn't include WhatsApp messaging. Upgrade your plan to use it."
            : `You've reached your plan's monthly WhatsApp message limit (${usage.used}/${usage.limit}). Upgrade your plan, or wait for next month's reset.`,
        code: usage.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
        featureKey: "WHATSAPP_MESSAGES",
      });
      return;
    }
  }

  // WEBSITE_CHAT has no external delivery step in this build — there's no
  // live customer-facing chat widget, so the message is simply stored as
  // conversation history, not attempted against an adapter (sendOnChannel
  // returns null for it, same as any contactHandle-less conversation).
  const delivery = await sendOnChannel(tenantId, conversation.channel, conversation.contactHandle, parsed.data.body);
  const status = statusFor(delivery);

  const message = await prisma.message.create({
    data: {
      tenantId, // tenant-scoped
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body: parsed.data.body,
      status,
      // Only WhatsApp sends return a real WAMID — Instagram/Facebook DM
      // deliveries and mock-mode sends never set delivery.externalId.
      externalId: delivery?.externalId ?? null,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: message.sentAt },
  });

  res.status(201).json({ message, delivery });
});

// --- Scheduled broadcasts ------------------------------------------------

router.get("/broadcasts", async (req, res) => {
  const broadcasts = await prisma.scheduledContent.findMany({
    where: { tenantId: req.tenantId, kind: "WHATSAPP_BROADCAST" }, // tenant-scoped
    orderBy: { scheduledAt: "desc" },
  });

  const customerIds = broadcasts.map((b) => b.targetCustomerId).filter((id): id is string => Boolean(id));
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds }, tenantId: req.tenantId } }) // tenant-scoped
    : [];
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  res.json(
    broadcasts.map((b) => ({
      ...b,
      targetCustomerName: b.targetCustomerId ? (nameById.get(b.targetCustomerId) ?? null) : null,
    }))
  );
});

const createBroadcastSchema = z
  .object({
    caption: z.string().trim().min(1, "Message is required"),
    // Not a fixed enum — validated against the tenant's own live category
    // list below (see lib/customerCategories.ts), same as
    // routes/customers.ts's create/import validation.
    targetSegment: z.string().trim().min(1).optional(),
    targetCustomerId: z.string().optional(),
    scheduledAt: z.string().min(1, "Scheduled time is required"),
  })
  .refine((d) => Boolean(d.targetSegment) !== Boolean(d.targetCustomerId), {
    message: "Choose either a segment or an individual customer, not both",
  });

router.post("/broadcasts", async (req, res) => {
  const parsed = createBroadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const d = parsed.data;

  if (d.targetCustomerId) {
    const exists = await prisma.customer.findFirst({ where: { id: d.targetCustomerId, tenantId: req.tenantId } }); // tenant-scoped
    if (!exists) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
  }

  if (d.targetSegment && !(await isValidCategory(req.tenantId!, d.targetSegment))) {
    res.status(400).json({ error: `Unknown category: ${d.targetSegment}` });
    return;
  }

  const scheduledAt = new Date(d.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    res.status(400).json({ error: "Invalid scheduled time" });
    return;
  }

  const broadcast = await prisma.scheduledContent.create({
    data: {
      tenantId: req.tenantId!, // tenant-scoped
      kind: "WHATSAPP_BROADCAST",
      channel: "WHATSAPP",
      caption: d.caption,
      targetSegment: d.targetSegment ?? null,
      targetCustomerId: d.targetCustomerId ?? null,
      scheduledAt,
      status: "scheduled",
    },
  });

  res.status(201).json(broadcast);
});

router.delete("/broadcasts/:id", async (req, res) => {
  const broadcast = await prisma.scheduledContent.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId, kind: "WHATSAPP_BROADCAST" }, // tenant-scoped
  });
  if (!broadcast) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (broadcast.status !== "scheduled") {
    res.status(400).json({ error: "Only scheduled broadcasts can be canceled" });
    return;
  }

  await prisma.scheduledContent.delete({ where: { id: broadcast.id } }); // tenant-scoped (existence already verified above)
  res.status(204).send();
});

export default router;
