import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { checkUsageLimit, incrementUsage } from "../lib/entitlements";

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const CONTENT_TYPES = [
  "Instagram Caption",
  "Facebook Post",
  "WhatsApp Message",
  "Festival Wish",
  "Product Description",
  "SEO Title",
  "Hashtags",
  "Ad Copy",
  "Best Posting Time",
] as const;

const TONES = ["Elegant", "Playful", "Traditional", "Bold", "Minimal"] as const;

const BASE_SYSTEM_PROMPT = `You are the in-house marketing copywriter for an Indian ethnic-wear boutique that sells sarees and related apparel through "BizzCore." Write copy that:
- Feels warm, aspirational, and rooted in Indian textile craft and tradition, without being cliché or overusing emoji
- Speaks directly to the boutique's customers: brides, festival shoppers, and everyday saree wearers
- Is concise and ready to publish as-is — no placeholders, no meta-commentary, no explanations before or after the copy
- Uses culturally appropriate references to fabrics (silk, cotton, chiffon, Banarasi, Kanjivaram, etc.), occasions (weddings, festivals like Diwali/Durga Puja, everyday wear), and Indian aesthetic sensibility where relevant`;

const CONTENT_TYPE_INSTRUCTIONS: Record<(typeof CONTENT_TYPES)[number], string> = {
  "Instagram Caption": "Write an Instagram caption (2-4 sentences) with a natural, scroll-stopping hook. Include 3-5 relevant hashtags at the end.",
  "Facebook Post": "Write a Facebook post (3-5 sentences), slightly more descriptive than Instagram, suited to a broader audience.",
  "WhatsApp Message": "Write a short WhatsApp broadcast message (2-3 sentences), personal and direct, as if messaging a loyal customer.",
  "Festival Wish": "Write a warm festival greeting suitable for sending to customers, tying in the boutique's offerings naturally without being overly salesy.",
  "Product Description": "Write an e-commerce product description (3-5 sentences) highlighting fabric, craftsmanship, occasion, and styling suggestions.",
  "SEO Title": "Write a single SEO-optimized product/page title, under 60 characters, keyword-rich. Output only the title.",
  Hashtags: "Generate 15-20 relevant Instagram hashtags, mixing broad and niche tags, space-separated. Output only the hashtags.",
  "Ad Copy": "Write short paid ad copy (a headline plus a 1-2 line body) suitable for Instagram/Facebook ads, with a clear call to action.",
  "Best Posting Time": "Recommend the best day(s) and time(s) to post this kind of content for an Indian ethnic-wear boutique's audience, with a one-sentence rationale. This is analysis, not promotional copy.",
};

const TONE_INSTRUCTIONS: Record<(typeof TONES)[number], string> = {
  Elegant: "elegant and refined — polished language, understated confidence",
  Playful: "playful and fun — light, energetic, conversational",
  Traditional: "traditional and heritage-focused — emphasize craft, heritage, and timelessness",
  Bold: "bold and confident — punchy, assertive, statement-making",
  Minimal: "minimal — spare, clean, few words, no fluff",
};

function buildUserMessage(
  contentType: (typeof CONTENT_TYPES)[number],
  tone: (typeof TONES)[number],
  productName?: string,
  context?: string
): string {
  const lines = [`Content type: ${contentType}`, `Tone: ${tone} — ${TONE_INSTRUCTIONS[tone]}`];
  if (productName) lines.push(`Product/saree name: ${productName}`);
  if (context) lines.push(`Additional context: ${context}`);
  lines.push("", CONTENT_TYPE_INSTRUCTIONS[contentType]);
  return lines.join("\n");
}

// Deliberately not cached at module scope: constructing an OpenAI client
// does no network I/O, so there's no cost to creating it fresh per
// request. Editing backend/.env still requires a process restart (env
// vars load once at boot), but this avoids an additional stale-cache
// layer on top of that, and keeps the "configured" check trivially
// testable by mutating process.env.OPENAI_API_KEY per test rather than
// fighting a module-level singleton left over from a previous test.
function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Lets the frontend show an upfront "not configured" banner (same pattern
// as /api/social/integration-status) instead of only surfacing it after a
// failed generate attempt.
router.get("/status", (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY) });
});

router.get("/generations", async (req, res) => {
  const generations = await prisma.aIGeneration.findMany({
    where: { tenantId: req.tenantId }, // tenant-scoped
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(generations);
});

const generateSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  tone: z.enum(TONES),
  productName: z.string().trim().optional(),
  context: z.string().trim().optional(),
});

// A single shared counter for all 9 content types — the catalog has more
// granular AI_* keys (AI_CAPTIONS, SEO_CONTENT, ...) but this is the only
// real generation endpoint in the app, so splitting usage across keys that
// don't correspond to distinct functionality would be misleading. Flagged
// as a product decision, not silently assumed — see entitlement-
// enforcement chat summary.
const AI_FEATURE_KEY = "AI_CONTENT_GENERATION";

// Status-only, never spends a unit (amount: 0) — lets the frontend show
// "X / Y used this month" without side effects.
router.get("/usage", async (req, res) => {
  const check = await checkUsageLimit(req.tenantId!, AI_FEATURE_KEY, 0);
  res.json(
    check.allowed
      ? { included: true, used: check.used, limit: check.limit }
      : { included: check.reason === "limit_reached", used: check.used, limit: check.limit }
  );
});

router.post("/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const usageCheck = await checkUsageLimit(req.tenantId!, AI_FEATURE_KEY);
  if (!usageCheck.allowed) {
    res.status(403).json({
      error:
        usageCheck.reason === "not_included"
          ? "Your current plan doesn't include AI Content Generation. Upgrade your plan to use it."
          : `You've reached your plan's monthly AI generation limit (${usageCheck.used}/${usageCheck.limit}). Upgrade your plan, or wait for next month's reset.`,
      code: usageCheck.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
      featureKey: AI_FEATURE_KEY,
    });
    return;
  }

  const openai = getClient();
  if (!openai) {
    res.status(503).json({ error: "AI Assistant is not configured. Set OPENAI_API_KEY in the backend environment." });
    return;
  }

  const { contentType, tone, productName, context } = parsed.data;

  let output: string | undefined;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: BASE_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(contentType, tone, productName, context) },
      ],
      temperature: 0.8,
      max_tokens: 400,
    });
    output = completion.choices[0]?.message?.content?.trim();
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI generation failed" });
    return;
  }

  if (!output) {
    res.status(502).json({ error: "AI Assistant returned an empty response. Please try again." });
    return;
  }

  const generation = await prisma.aIGeneration.create({
    data: {
      tenantId: req.tenantId!, // tenant-scoped
      userId: req.user!.id,
      contentType,
      tone,
      productName: productName || null,
      context: context || null,
      output,
    },
  });

  // Only spent on a confirmed success — a failed/empty OpenAI response
  // (handled above, before this point) never consumes a unit.
  await incrementUsage(req.tenantId!, AI_FEATURE_KEY);

  res.status(201).json(generation);
});

export default router;
