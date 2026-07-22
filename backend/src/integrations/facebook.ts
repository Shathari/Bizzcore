import { getTenantMetaCredentials } from "./metaCredentials";

export type MetaResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

const apiVersion = () => process.env.META_GRAPH_API_VERSION ?? "v20.0";

// Facebook Page posts via the Graph API. Same mediaUrl caveat as
// instagram.ts's publishInstagramPost — must be publicly reachable.
export async function publishFacebookPost(
  tenantId: string,
  mediaUrl: string | null,
  caption: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.pageId) {
    console.log(`[facebook:mock] Would publish post to Facebook Page (no Meta credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }

  try {
    const endpoint = mediaUrl
      ? `https://graph.facebook.com/${apiVersion()}/${creds.pageId}/photos`
      : `https://graph.facebook.com/${apiVersion()}/${creds.pageId}/feed`;
    const body = mediaUrl ? { url: mediaUrl, caption } : { message: caption };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { delivered: false, mode: "live", error: `Facebook API error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Facebook delivery error",
    };
  }
}

export async function sendFacebookDirectMessage(
  tenantId: string,
  recipientId: string,
  text: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.pageId) {
    console.log(`[facebook:mock] Would send Facebook Messenger DM to ${recipientId} (no Meta credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion()}/me/messages?access_token=${creds.accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { delivered: false, mode: "live", error: `Facebook API error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Facebook delivery error",
    };
  }
}

// Same limitation as instagram.ts's replyToInstagramComment — needs a
// real webhook-ingested comment id, which this project doesn't have yet.
export async function replyToFacebookComment(
  tenantId: string,
  externalCommentId: string | null,
  message: string
): Promise<MetaResult> {
  const creds = await getTenantMetaCredentials(tenantId);
  if (!creds?.pageId || !externalCommentId) {
    console.log(`[facebook:mock] Would reply to Facebook comment ${externalCommentId ?? "(no external id — demo comment)"}`);
    return { delivered: false, mode: "mock" };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion()}/${externalCommentId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { delivered: false, mode: "live", error: `Facebook API error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown Facebook delivery error",
    };
  }
}
