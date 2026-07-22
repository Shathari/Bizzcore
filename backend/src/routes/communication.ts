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

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const CHANNELS = ["WHATSAPP", "WEBSITE_CHAT", "INSTAGRAM_DM", "FACEBOOK_DM"] as const;

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

  let delivery: { mode: "live" | "mock"; delivered: boolean; error?: string } | null = null;

  // WEBSITE_CHAT has no external delivery step in this build — there's no
  // live customer-facing chat widget, so the message is simply stored as
  // conversation history, not attempted against an adapter.
  if (conversation.channel === "WHATSAPP" && conversation.contactHandle) {
    delivery = await sendWhatsAppMessage(tenantId, conversation.contactHandle, parsed.data.body);
  } else if (conversation.channel === "INSTAGRAM_DM" && conversation.contactHandle) {
    delivery = await sendInstagramDirectMessage(tenantId, conversation.contactHandle, parsed.data.body);
  } else if (conversation.channel === "FACEBOOK_DM" && conversation.contactHandle) {
    delivery = await sendFacebookDirectMessage(tenantId, conversation.contactHandle, parsed.data.body);
  }

  // A live attempt that genuinely failed is worth surfacing as "failed" in
  // history; mock mode still counts as "sent" from the tenant's workflow
  // perspective (recorded, just not actually delivered to a real API yet).
  const status = delivery && !delivery.delivered && delivery.mode === "live" ? "failed" : "sent";

  const message = await prisma.message.create({
    data: {
      tenantId, // tenant-scoped
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body: parsed.data.body,
      status,
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
    targetSegment: z.enum(["Regular", "VIP", "Bridal"]).optional(),
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
