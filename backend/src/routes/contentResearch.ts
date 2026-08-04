import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { resolveTenant } from "../middleware/resolveTenant";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { checkUsageLimit, incrementUsage } from "../lib/entitlements";
import { isConfigured, runContentResearch, generateResearchScript, type SelectedPattern } from "../lib/contentResearch";
import { TONES, TONE_INSTRUCTIONS } from "./ai";

// Content Research Lab — Stage 1: tenant submits reference links -> Apify
// fetches public performance metadata for each -> an AI call identifies
// recurring structural/topical patterns across them, producing a
// ContentResearchReport. Core pipeline lives in lib/contentResearch.ts;
// this file is the HTTP layer — entitlement gating, request validation, and
// response shaping only.

const router = Router();
router.use(authenticate, requirePasswordSet, resolveTenant, authorize("ADMIN"));

const FEATURE_KEY = "CONTENT_RESEARCH";
const MAX_LINKS = 25;
// Stage 2 is a script/caption/hashtag generation, same cost profile and
// quota as any other Compose generation — CONTENT_RESEARCH only gates the
// Apify-cost Stage 1 research run, not this step.
const SCRIPT_FEATURE_KEY = "AI_CONTENT_GENERATION";

router.get("/status", (_req, res) => {
  res.json({ configured: isConfigured() });
});

router.get("/usage", async (req, res) => {
  const check = await checkUsageLimit(req.tenantId!, FEATURE_KEY, 0);
  res.json(
    check.allowed
      ? { included: true, used: check.used, limit: check.limit }
      : { included: check.reason === "limit_reached", used: check.used, limit: check.limit }
  );
});

router.get("/", async (req, res) => {
  const reports = await prisma.contentResearchReport.findMany({
    where: { tenantId: req.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { links: true } } },
  });
  res.json(reports);
});

router.get("/:id", async (req, res) => {
  const report = await prisma.contentResearchReport.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    include: { links: { orderBy: { createdAt: "asc" } } },
  });
  if (!report) {
    res.status(404).json({ error: "Research report not found" });
    return;
  }
  res.json(report);
});

const createSchema = z.object({
  links: z
    .array(z.string().trim().url("Each line must be a valid URL"))
    .min(1, "Add at least one reference link")
    .max(MAX_LINKS, `Up to ${MAX_LINKS} links per research run`),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const usageCheck = await checkUsageLimit(req.tenantId!, FEATURE_KEY);
  if (!usageCheck.allowed) {
    res.status(403).json({
      error:
        usageCheck.reason === "not_included"
          ? "Your current plan doesn't include Content Research Lab. Upgrade your plan to use it."
          : `You've reached your plan's monthly Content Research limit (${usageCheck.used}/${usageCheck.limit}). Upgrade your plan, or wait for next month's reset.`,
      code: usageCheck.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
      featureKey: FEATURE_KEY,
    });
    return;
  }

  if (!isConfigured()) {
    res.status(503).json({ error: "Content Research Lab is not configured. Set OPENAI_API_KEY and APIFY_API_TOKEN in the backend environment." });
    return;
  }

  const report = await runContentResearch({ tenantId: req.tenantId!, userId: req.user!.id, links: parsed.data.links });

  if (report.status !== "COMPLETED") {
    res.status(502).json(report);
    return;
  }

  // Only spent once the report genuinely completed end to end.
  await incrementUsage(req.tenantId!, FEATURE_KEY);

  res.status(201).json(report);
});

// --- Stage 2 — pattern selection -> original script + captions/hashtags ---

const generateScriptSchema = z.object({
  patternIds: z.array(z.string()).min(1, "Select at least one pattern").max(10),
  tone: z.enum(TONES),
  productName: z.string().trim().optional(),
  context: z.string().trim().optional(),
});

router.post("/:id/generate-script", async (req, res) => {
  const parsed = generateScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const report = await prisma.contentResearchReport.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
  if (!report) {
    res.status(404).json({ error: "Research report not found" });
    return;
  }
  if (report.status !== "COMPLETED" || !report.patterns) {
    res.status(400).json({ error: "This research report hasn't completed successfully yet." });
    return;
  }

  const allPatterns = JSON.parse(report.patterns) as SelectedPattern[];
  const selected = allPatterns.filter((p) => parsed.data.patternIds.includes(p.id));
  if (selected.length === 0) {
    res.status(400).json({ error: "None of the selected pattern IDs exist on this report." });
    return;
  }

  const usageCheck = await checkUsageLimit(req.tenantId!, SCRIPT_FEATURE_KEY);
  if (!usageCheck.allowed) {
    res.status(403).json({
      error:
        usageCheck.reason === "not_included"
          ? "Your current plan doesn't include AI Content Generation. Upgrade your plan to use it."
          : `You've reached your plan's monthly AI generation limit (${usageCheck.used}/${usageCheck.limit}). Upgrade your plan, or wait for next month's reset.`,
      code: usageCheck.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
      featureKey: SCRIPT_FEATURE_KEY,
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "AI Assistant is not configured. Set OPENAI_API_KEY in the backend environment." });
    return;
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId! }, select: { businessName: true } });

  let generation;
  try {
    generation = await generateResearchScript({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      businessName: tenant.businessName,
      reportId: report.id,
      patterns: selected,
      tone: parsed.data.tone,
      toneInstruction: TONE_INSTRUCTIONS[parsed.data.tone],
      productName: parsed.data.productName,
      context: parsed.data.context,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Script generation failed" });
    return;
  }

  // Only spent once the generation genuinely succeeded.
  await incrementUsage(req.tenantId!, SCRIPT_FEATURE_KEY);

  res.status(201).json(generation);
});

export default router;
