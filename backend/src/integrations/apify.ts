// Apify-backed public-metadata fetch for Content Research Lab reference
// links. Platform-level credential (APIFY_API_TOKEN in env) rather than a
// per-tenant IntegrationCredential: tenants don't have their own Apify
// accounts, they just submit reference links — BizzCore's own Apify account
// funds every tenant's research runs, gated per-tenant by the
// CONTENT_RESEARCH usage quota instead of by whose API key is used.
//
// Only ever fetches public post/video metadata (view/like/comment counts,
// hashtags, format signals) — see routes/contentResearch.ts for how
// captionText/rawMetadata captured here are deliberately excluded from
// every AI prompt built downstream.

export type Platform = "INSTAGRAM" | "YOUTUBE" | "TIKTOK";

export function detectPlatform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("instagram.com")) return "INSTAGRAM";
  if (host.includes("youtube.com") || host === "youtu.be") return "YOUTUBE";
  if (host.includes("tiktok.com")) return "TIKTOK";
  return null;
}

function getToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not configured");
  return token;
}

// Apify API addresses actors as "owner~actorName" in the URL path.
const ACTORS: Record<Platform, string> = {
  INSTAGRAM: "apify~instagram-post-scraper",
  TIKTOK: "clockworks~tiktok-scraper",
  YOUTUBE: "streamers~youtube-scraper",
};

export type LinkMetadata = {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  durationSeconds: number | null;
  postedAt: Date | null;
  hashtags: string[];
  captionText: string | null; // audit/re-analysis only — never fed to an AI prompt
  rawMetadata: Record<string, unknown>;
};

function buildInput(platform: Platform, url: string): Record<string, unknown> {
  switch (platform) {
    case "INSTAGRAM":
      return { username: [url], resultsLimit: 1, dataDetailLevel: "basicData" };
    case "TIKTOK":
      return { postURLs: [url], resultsPerPage: 1 };
    case "YOUTUBE":
      return { startUrls: [{ url }], maxResults: 1 };
  }
}

// Handles plain seconds ("125"), "MM:SS", and "HH:MM:SS" — different actors
// return duration in different shapes.
function parseDuration(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    if (/^\d+$/.test(value.trim())) return Number(value.trim());
    const parts = value.split(":").map(Number);
    if (parts.length === 0 || parts.some((p) => Number.isNaN(p))) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapItem(platform: Platform, item: Record<string, unknown>): LinkMetadata {
  switch (platform) {
    case "INSTAGRAM":
      return {
        viewCount: (item.videoViewCount as number) ?? (item.videoPlayCount as number) ?? null,
        likeCount: typeof item.likesCount === "number" && item.likesCount >= 0 ? item.likesCount : null,
        commentCount: (item.commentsCount as number) ?? null,
        shareCount: null, // Instagram doesn't expose share counts publicly
        durationSeconds: parseDuration(item.videoDuration),
        postedAt: toDate(item.timestamp),
        hashtags: Array.isArray(item.hashtags) ? (item.hashtags as string[]) : [],
        captionText: typeof item.caption === "string" ? item.caption : null,
        rawMetadata: item,
      };
    case "TIKTOK": {
      const videoMeta = item.videoMeta as Record<string, unknown> | undefined;
      return {
        viewCount: (item.playCount as number) ?? null,
        likeCount: (item.diggCount as number) ?? null,
        commentCount: (item.commentCount as number) ?? null,
        shareCount: (item.shareCount as number) ?? null,
        durationSeconds: parseDuration(videoMeta?.duration),
        postedAt: toDate(item.createTimeISO),
        hashtags: Array.isArray(item.hashtags)
          ? (item.hashtags as Array<{ name?: string } | string>)
              .map((h) => (typeof h === "string" ? h : (h.name ?? "")))
              .filter(Boolean)
          : [],
        captionText: typeof item.text === "string" ? item.text : null,
        rawMetadata: item,
      };
    }
    case "YOUTUBE":
      return {
        viewCount: typeof item.viewCount === "number" ? item.viewCount : Number(item.viewCount) || null,
        likeCount: typeof item.likes === "number" ? item.likes : Number(item.likes) || null,
        commentCount: (item.commentsCount as number) ?? null,
        shareCount: null,
        durationSeconds: parseDuration(item.duration),
        postedAt: toDate(item.date),
        hashtags: Array.isArray(item.hashtags) ? (item.hashtags as string[]) : [],
        // The actor returns the video description under `text`, not `description`.
        captionText: typeof item.text === "string" ? item.text : typeof item.description === "string" ? item.description : null,
        rawMetadata: item,
      };
  }
}

export async function fetchLinkMetadata(url: string): Promise<{ platform: Platform; metadata: LinkMetadata }> {
  const platform = detectPlatform(url);
  if (!platform) throw new Error(`Unsupported platform for URL: ${url}`);

  const actorId = ACTORS[platform];
  const input = buildInput(platform, url);

  const response = await fetch(`https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${getToken()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Apify actor ${actorId} failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const items = (await response.json()) as Record<string, unknown>[];
  const item = items[0];
  if (!item) throw new Error(`Apify actor ${actorId} returned no results for ${url}`);
  if (item.error) throw new Error(`Apify could not fetch ${url}: ${String(item.errorDescription ?? item.error)}`);

  return { platform, metadata: mapItem(platform, item) };
}
