import { z } from "zod";
import OpenAI from "openai";
import { prisma } from "./prisma";
import { detectPlatform, fetchLinkMetadata } from "../integrations/apify";

// Content Research Lab — Stage 1 core pipeline: reference links -> Apify
// metadata fetch -> AI pattern-research call -> ContentResearchReport.
// Deliberately independent of Express/auth so it's callable both from
// routes/contentResearch.ts (real tenant requests) and from one-off
// operational scripts (e.g. testing against a tenant whose admin
// credentials aren't available) without needing an HTTP session.
//
// Hard constraint carried through this whole file: ContentResearchLink's
// captionText/rawMetadata are stored for the tenant's own audit/re-analysis
// only. The AI prompt built here (buildResearchUserMessage) reads
// exclusively from the aggregated fields (view/like/comment/share counts,
// hashtags, duration, postedAt) — never captionText.

export function getOpenAiClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function isConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.APIFY_API_TOKEN);
}

const RESEARCH_SYSTEM_PROMPT = `You are a social media content strategist. A business is researching what content patterns tend to perform well in their niche, using a set of reference videos/posts from other creators, before creating their OWN original content inspired by (not copied from) those patterns.

You are given ONLY aggregated public performance metadata for each reference item: view/like/comment/share counts, hashtags, platform, duration, and posting date. You are NEVER given and must NEVER assume, invent, or guess the actual written caption, spoken dialogue, or script of any reference item — you do not have access to that content and must not pretend otherwise.

Your job is to identify RECURRING STRUCTURAL AND TOPICAL PATTERNS across the set — not to describe or rank any single item. A pattern is only meaningful if it appears across MULTIPLE items; the single highest-performing outlier alone is not a pattern.

Patterns inferable from this kind of metadata include: video-length bands that correlate with higher engagement, posting-cadence/day-of-week signals from timestamps, hashtag/topic clusters that repeat across top performers, format signals inferable from duration + platform (e.g. short-form under 60s vs. long-form), and engagement-ratio signals (e.g. an unusually high comment-to-view ratio suggesting a discussion-provoking format).

CRITICAL RULES — follow these exactly:
- NEVER quote, reproduce, or closely paraphrase a specific hashtag string, title, or any text from a single reference item as if it were the pattern. Describe the KIND of thing that recurs in the abstract (e.g. "short, direct-address question posed in the opening seconds"), never an actual line from any item.
- Every pattern you report must list which reference items it was observed in (by their label, e.g. "L1", "L3") and the resulting occurrenceCount.
- Do not report a pattern seen in only one item unless occurrenceCount is honestly 1 — do not inflate counts.
- Base every claim strictly on the metadata provided. Do not fabricate details you weren't given.

Respond ONLY with strict JSON of this exact shape, no other text:
{"summary": "2-4 sentence overview of what the research found", "patterns": [{"type": "HOOK|FORMAT|TOPIC|STRUCTURE|CADENCE", "title": "short pattern name", "description": "what the pattern is, in the abstract — never a quoted line", "occurrenceCount": number, "exampleLinkLabels": ["L1", "L3"]}]}`;

type FetchedLink = {
  label: string;
  linkId: string;
  platform: string;
  url: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  durationSeconds: number | null;
  postedAt: Date | null;
  hashtags: string[];
};

function buildResearchUserMessage(items: FetchedLink[]): string {
  const lines = items.map((item) => {
    // Only aggregated/structural fields — no captionText, ever.
    const { label, platform, viewCount, likeCount, commentCount, shareCount, durationSeconds, postedAt, hashtags } = item;
    return JSON.stringify({ label, platform, viewCount, likeCount, commentCount, shareCount, durationSeconds, postedAt: postedAt?.toISOString() ?? null, hashtags });
  });
  return `Reference items (one JSON object per line):\n${lines.join("\n")}`;
}

const patternResponseSchema = z.object({
  summary: z.string().trim().min(1),
  patterns: z
    .array(
      z.object({
        type: z.enum(["HOOK", "FORMAT", "TOPIC", "STRUCTURE", "CADENCE"]),
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        occurrenceCount: z.number().int().min(1),
        exampleLinkLabels: z.array(z.string()).min(1),
      })
    )
    .min(1),
});

export type RunContentResearchParams = {
  tenantId: string;
  userId: string;
  links: string[];
};

// Runs the full pipeline and always returns the report (its `status` field
// tells you whether it ended COMPLETED or FAILED) — never throws for a
// pipeline-level failure, only for programmer errors (e.g. missing config,
// checked by the caller beforehand via isConfigured()).
export async function runContentResearch({ tenantId, userId, links }: RunContentResearchParams) {
  const openai = getOpenAiClient();
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");
  if (!process.env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN is not configured");

  const report = await prisma.contentResearchReport.create({
    data: { tenantId, userId, status: "FETCHING", seedLinks: JSON.stringify(links) },
  });

  const fetchResults = await Promise.allSettled(
    links.map(async (url) => {
      const platform = detectPlatform(url);
      if (!platform) throw new Error(`Unsupported platform for URL: ${url}`);
      const { metadata } = await fetchLinkMetadata(url);
      return { url, platform, metadata };
    })
  );

  const createdLinks: FetchedLink[] = [];
  for (let i = 0; i < fetchResults.length; i++) {
    const result = fetchResults[i];
    const url = links[i];
    if (result.status === "fulfilled") {
      const { platform, metadata } = result.value;
      const link = await prisma.contentResearchLink.create({
        data: {
          reportId: report.id,
          url,
          platform,
          fetchStatus: "FETCHED",
          viewCount: metadata.viewCount,
          likeCount: metadata.likeCount,
          commentCount: metadata.commentCount,
          shareCount: metadata.shareCount,
          durationSeconds: metadata.durationSeconds,
          postedAt: metadata.postedAt,
          hashtags: JSON.stringify(metadata.hashtags),
          captionText: metadata.captionText,
          rawMetadata: JSON.stringify(metadata.rawMetadata),
        },
      });
      createdLinks.push({
        label: `L${createdLinks.length + 1}`,
        linkId: link.id,
        platform,
        url,
        viewCount: metadata.viewCount,
        likeCount: metadata.likeCount,
        commentCount: metadata.commentCount,
        shareCount: metadata.shareCount,
        durationSeconds: metadata.durationSeconds,
        postedAt: metadata.postedAt,
        hashtags: metadata.hashtags,
      });
    } else {
      const platform = detectPlatform(url);
      await prisma.contentResearchLink.create({
        data: {
          reportId: report.id,
          url,
          platform: platform ?? "UNKNOWN",
          fetchStatus: "FAILED",
          errorMessage: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
      });
    }
  }

  if (createdLinks.length === 0) {
    return prisma.contentResearchReport.update({
      where: { id: report.id },
      data: { status: "FAILED", errorMessage: "None of the submitted links could be fetched." },
      include: { links: true },
    });
  }

  await prisma.contentResearchReport.update({ where: { id: report.id }, data: { status: "ANALYZING" } });

  let patternsResult: z.infer<typeof patternResponseSchema>;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: buildResearchUserMessage(createdLinks) },
      ],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content;
    const rawJson = raw ? JSON.parse(raw) : null;
    const validated = patternResponseSchema.safeParse(rawJson);
    if (!validated.success) throw new Error("AI returned an unexpected response shape");
    patternsResult = validated.data;
  } catch (err) {
    return prisma.contentResearchReport.update({
      where: { id: report.id },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : "Pattern analysis failed" },
      include: { links: true },
    });
  }

  const labelToLinkId = new Map(createdLinks.map((l) => [l.label, l.linkId]));
  const patterns = patternsResult.patterns.map((p, i) => ({
    id: `pattern_${i + 1}`,
    type: p.type,
    title: p.title,
    description: p.description,
    occurrenceCount: p.occurrenceCount,
    exampleLinkIds: p.exampleLinkLabels.map((label) => labelToLinkId.get(label)).filter((id): id is string => Boolean(id)),
  }));

  return prisma.contentResearchReport.update({
    where: { id: report.id },
    data: { status: "COMPLETED", summary: patternsResult.summary, patterns: JSON.stringify(patterns) },
    include: { links: { orderBy: { createdAt: "asc" } } },
  });
}

// ---------------------------------------------------------------------------
// Stage 2 — pattern selection -> original script + captions + hashtags.
// Reuses the same AIGeneration table the rest of the AI Assistant's Compose
// flow already writes to (contentType: "Research Script"), so output is
// browsable through the existing /ai/generations history alongside every
// other generation type — not a separate, disconnected store.
//
// Hard constraint: the prompt built here (buildScriptUserMessage) is
// constructed ONLY from each selected pattern's title/type/description/
// occurrenceCount — the abstracted research output. It never has access to
// ContentResearchLink.captionText/rawMetadata at all (this function isn't
// even passed them), so there is nothing verbatim it could reproduce even
// by mistake.
// ---------------------------------------------------------------------------

export type SelectedPattern = {
  id: string;
  type: string;
  title: string;
  description: string;
  occurrenceCount: number;
};

function buildScriptSystemPrompt(businessName: string): string {
  return `You are a content creator and marketing copywriter working for "${businessName}", writing on the BizzCore platform.

You have been given a RESEARCH BRIEF describing patterns that recur across high-performing content in this business's niche — hook style, format, topic, or other structural choices. You do NOT have access to, and must NEVER attempt to reconstruct, quote, or imitate, any specific reference video's actual dialogue, caption, or written content. The brief describes patterns in the abstract only, never any real video's actual words — treat it that way even if a pattern description sounds specific.

Your job is to write a genuinely ORIGINAL short-form video/content script for "${businessName}" that is INSPIRED BY the given pattern(s) — adopting the same kind of structural approach (e.g. hook style, pacing, format) described — while being entirely new content built around this business's own products, voice, and offer. The result must read as this business's own original creative work, never a reworded copy of anyone else's video.

Write the script broken into clear beats (e.g. HOOK / BODY / CTA, or numbered scenes — whatever structure fits the pattern), specific and concrete enough to be immediately usable either for AI-assisted content creation or handed to a human creator to film from — no placeholders like "[product here]". Then write one matching social caption and a set of relevant hashtags in the same voice.

Respond ONLY with strict JSON of this exact shape, no other text:
{"script": "the full script, with clear scene/beat structure", "caption": "a ready-to-post social caption", "hashtags": ["#tag1", "#tag2", ...]}`;
}

function buildScriptUserMessage(
  patterns: SelectedPattern[],
  tone: string,
  toneInstruction: string,
  productName?: string,
  context?: string
): string {
  const lines = [
    `Tone: ${tone} — ${toneInstruction}`,
    productName ? `Feature this product/offer: ${productName}` : undefined,
    context ? `Additional direction from the business: ${context}` : undefined,
    "",
    "Research brief — patterns to draw structural inspiration from (abstract descriptions only, not real captions):",
    ...patterns.map((p) => `- [${p.type}] ${p.title} (observed across ${p.occurrenceCount} reference item(s)): ${p.description}`),
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

const scriptResponseSchema = z.object({
  script: z.string().trim().min(1),
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string().trim().min(1)).min(1),
});

export type GenerateResearchScriptParams = {
  tenantId: string;
  userId: string;
  businessName: string;
  reportId: string;
  patterns: SelectedPattern[];
  tone: string;
  toneInstruction: string;
  productName?: string;
  context?: string;
};

// Throws on OpenAI/parse failure — unlike runContentResearch, there's no
// partial-progress DB row to reconcile here (nothing is written until the
// generation fully succeeds), so the caller (the route) can just catch and
// respond, no report-status bookkeeping needed.
export async function generateResearchScript(params: GenerateResearchScriptParams) {
  const openai = getOpenAiClient();
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: buildScriptSystemPrompt(params.businessName) },
      { role: "user", content: buildScriptUserMessage(params.patterns, params.tone, params.toneInstruction, params.productName, params.context) },
    ],
    temperature: 0.8,
    max_tokens: 1200,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content;
  const rawJson = raw ? JSON.parse(raw) : null;
  const validated = scriptResponseSchema.safeParse(rawJson);
  if (!validated.success) throw new Error("AI returned an unexpected response shape");

  const output = [`SCRIPT:`, validated.data.script, ``, `CAPTION:`, validated.data.caption, ``, `HASHTAGS:`, validated.data.hashtags.join(" ")].join("\n");

  return prisma.aIGeneration.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      contentType: "Research Script",
      tone: params.tone,
      productName: params.productName || null,
      context: params.context || null,
      output,
      researchReportId: params.reportId,
      selectedPatternIds: JSON.stringify(params.patterns.map((p) => p.id)),
    },
  });
}
