import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { createUploader, publicUrlFor, deleteUploadedFile, handleUpload } from "../lib/upload";
import { getTenantMetaCredentials } from "../integrations/metaCredentials";
import { replyToInstagramComment } from "../integrations/instagram";
import { replyToFacebookComment } from "../integrations/facebook";
import { checkAndIncrementUsage } from "../lib/entitlements";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const CHANNELS = ["INSTAGRAM", "FACEBOOK"] as const;
const POST_TYPES = ["POST", "STORY", "REEL"] as const;
const upload = createUploader("social");

// Page-level indicator for the "mock mode vs. live" banner — Instagram and
// Facebook share one Meta credential, so a single check covers both.
router.get("/integration-status", async (req, res) => {
  const creds = await getTenantMetaCredentials(req.tenantId!);
  res.json({ connected: Boolean(creds?.pageId || creds?.igBusinessAccountId) });
});

// --- Post scheduler ------------------------------------------------------

router.get("/posts", async (req, res) => {
  const posts = await prisma.scheduledContent.findMany({
    where: { tenantId: req.tenantId, kind: "SOCIAL_POST" }, // tenant-scoped
    orderBy: { scheduledAt: "desc" },
  });
  res.json(posts);
});

const createPostSchema = z.object({
  channel: z.enum(CHANNELS),
  postType: z.enum(POST_TYPES).optional(),
  caption: z.string().trim().optional(),
  scheduledAt: z.string().min(1, "Scheduled time is required"),
});

router.post("/posts", handleUpload(upload.single("media")), async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  const scheduledAt = new Date(d.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    if (req.file) deleteUploadedFile(publicUrlFor(tenantId, "social", req.file.filename));
    res.status(400).json({ error: "Invalid scheduled time" });
    return;
  }

  // Metered at scheduling time, not at eventual publish — SCHEDULED_POSTS
  // is about how many posting slots a plan grants, not delivery outcome.
  const usage = await checkAndIncrementUsage(tenantId, "SCHEDULED_POSTS");
  if (!usage.allowed) {
    if (req.file) deleteUploadedFile(publicUrlFor(tenantId, "social", req.file.filename));
    res.status(403).json({
      error:
        usage.reason === "not_included"
          ? "Your current plan doesn't include scheduled posts. Upgrade your plan to use it."
          : `You've reached your plan's monthly scheduled post limit (${usage.used}/${usage.limit}). Upgrade your plan, or wait for next month's reset.`,
      code: usage.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
      featureKey: "SCHEDULED_POSTS",
    });
    return;
  }

  const post = await prisma.scheduledContent.create({
    data: {
      tenantId, // tenant-scoped
      kind: "SOCIAL_POST",
      channel: d.channel,
      postType: d.postType ?? "POST",
      caption: d.caption || null,
      mediaUrl: req.file ? publicUrlFor(tenantId, "social", req.file.filename) : null,
      scheduledAt,
      status: "scheduled",
    },
  });

  res.status(201).json(post);
});

router.delete("/posts/:id", async (req, res) => {
  const post = await prisma.scheduledContent.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId, kind: "SOCIAL_POST" }, // tenant-scoped
  });
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (post.status !== "scheduled") {
    res.status(400).json({ error: "Only scheduled posts can be canceled" });
    return;
  }
  if (post.mediaUrl) deleteUploadedFile(post.mediaUrl);
  await prisma.scheduledContent.delete({ where: { id: post.id } }); // tenant-scoped (existence verified above)
  res.status(204).send();
});

// --- Comments --------------------------------------------------------------

router.get("/comments", async (req, res) => {
  const comments = await prisma.socialComment.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
  });
  res.json(comments);
});

const replySchema = z.object({ message: z.string().trim().min(1, "Reply can't be empty") });

router.post("/comments/:id/reply", async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const comment = await prisma.socialComment.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId }, // tenant-scoped
  });
  if (!comment) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const tenantId = req.tenantId!;
  const delivery =
    comment.channel === "FACEBOOK"
      ? await replyToFacebookComment(tenantId, comment.externalCommentId, parsed.data.message)
      : await replyToInstagramComment(tenantId, comment.externalCommentId, parsed.data.message);

  const updated = await prisma.socialComment.update({
    where: { id: comment.id },
    data: { reply: parsed.data.message, repliedAt: new Date() },
  });

  res.json({ comment: updated, delivery });
});

export default router;
