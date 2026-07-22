import { getTenantMetaCredentials } from "./metaCredentials";

export type MetaResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

const apiVersion = () => process.env.META_GRAPH_API_VERSION ?? "v20.0";

export async function sendInstagramDirectMessage(
  tenantId: string,
  recipientId: string,
  text: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.igBusinessAccountId) {
    console.log(`[instagram:mock] Would send Instagram DM to ${recipientId} (no Meta credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion()}/${creds.igBusinessAccountId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { delivered: false, mode: "live", error: `Instagram API error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Instagram delivery error",
    };
  }
}

// Content Publishing API — two-step: create a media container, then
// publish it. `mediaUrl` must be a publicly reachable URL for Meta's
// servers to fetch (a localhost dev URL won't actually work even with
// real credentials — a genuine limitation of local dev, not a bug here).
export async function publishInstagramPost(
  tenantId: string,
  mediaUrl: string | null,
  caption: string,
  postType: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.igBusinessAccountId) {
    console.log(`[instagram:mock] Would publish ${postType} to Instagram (no Meta credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }
  if (!mediaUrl) {
    return { delivered: false, mode: "live", error: "Instagram posts require a media file" };
  }

  try {
    const mediaType = postType === "REEL" ? "REELS" : postType === "STORY" ? "STORIES" : undefined;
    const containerResp = await fetch(`https://graph.facebook.com/${apiVersion()}/${creds.igBusinessAccountId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: mediaType ? undefined : mediaUrl,
        video_url: mediaType ? mediaUrl : undefined,
        media_type: mediaType,
        caption,
      }),
    });
    if (!containerResp.ok) {
      const errText = await containerResp.text();
      return { delivered: false, mode: "live", error: `Instagram API error ${containerResp.status}: ${errText.slice(0, 200)}` };
    }
    const { id: creationId } = (await containerResp.json()) as { id: string };

    const publishResp = await fetch(`https://graph.facebook.com/${apiVersion()}/${creds.igBusinessAccountId}/media_publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId }),
    });
    if (!publishResp.ok) {
      const errText = await publishResp.text();
      return { delivered: false, mode: "live", error: `Instagram API error ${publishResp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Instagram delivery error",
    };
  }
}

// Requires a real Meta comment id, which only exists once real webhook
// ingestion is built (see SocialComment.externalCommentId) — until then
// this always runs in mock mode regardless of configured credentials,
// since seeded demo comments have no such id.
export async function replyToInstagramComment(
  tenantId: string,
  externalCommentId: string | null,
  message: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.igBusinessAccountId || !externalCommentId) {
    console.log(`[instagram:mock] Would reply to Instagram comment ${externalCommentId ?? "(no external id — demo comment)"}`);
    return { delivered: false, mode: "mock" };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion()}/${externalCommentId}/replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { delivered: false, mode: "live", error: `Instagram API error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Instagram delivery error",
    };
  }
}
