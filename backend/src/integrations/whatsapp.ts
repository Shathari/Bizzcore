import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

export type WhatsAppResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

type WhatsAppCredentials = { phoneNumberId: string; accessToken: string };

async function callWhatsAppApi(creds: WhatsAppCredentials, to: string, body: string): Promise<WhatsAppResult> {
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { delivered: false, mode: "live", error: `WhatsApp API error ${resp.status}: ${text.slice(0, 200)}` };
    }
    return { delivered: true, mode: "live" };
  } catch (err) {
    return {
      delivered: false,
      mode: "live",
      error: err instanceof Error ? err.message : "Unknown WhatsApp delivery error",
    };
  }
}

// Unlike email.ts (platform-level, env-configured — BizzCore's own
// transactional delivery), this one is a per-tenant integration: each
// boutique has its own WhatsApp Business number. Credentials live encrypted
// in IntegrationCredential, entered by the tenant admin via Settings. Until
// a tenant has configured one, every send here runs in mock mode. Used for
// messaging a TENANT's OWN customers (Communication Center replies,
// scheduled broadcasts) — see sendPlatformWhatsAppMessage below for
// BizzCore's own outbound messages, which can't use this path.
async function getTenantCredentials(tenantId: string): Promise<WhatsAppCredentials | null> {
  const record = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: "WHATSAPP" } },
  });
  if (!record) return null;
  try {
    return JSON.parse(decrypt(record.encryptedPayload)) as WhatsAppCredentials;
  } catch {
    return null;
  }
}

export async function sendWhatsAppMessage(tenantId: string, to: string, body: string): Promise<WhatsAppResult> {
  const creds = await getTenantCredentials(tenantId);
  if (!creds) {
    console.log(`[whatsapp:mock] Would send WhatsApp message to ${to} (no WhatsApp credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }
  return callWhatsAppApi(creds, to, body);
}

function getPlatformCredentials(): WhatsAppCredentials | null {
  const phoneNumberId = process.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_PLATFORM_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

// Platform-level send — BizzCore's OWN WhatsApp Business number
// (env-configured, same pattern as email.ts's RESEND_API_KEY/EMAIL_FROM),
// used for transactional messages BizzCore itself sends about a business's
// account (currently: credential delivery on Add Business / resend). A
// brand-new tenant has no WhatsApp credentials of its own configured yet at
// the moment its account is created, so this can only ever go out from
// BizzCore's own number, not the tenant's — deliberately a separate
// function/credential source from sendWhatsAppMessage above, not a
// tenantId-optional variant of it.
//
// Note: WhatsApp Cloud API restricts business-initiated messages to a
// recipient with no prior 24-hour customer-service window to APPROVED
// TEMPLATE messages — a first-ever contact with a new business owner's
// number (exactly this use case) is very likely to be rejected as a
// freeform text message. If that happens in practice, this needs to switch
// to a `type: "template"` payload using an approved template name/language,
// not a code change to the mock/live gating itself.
export async function sendPlatformWhatsAppMessage(to: string, body: string): Promise<WhatsAppResult> {
  const creds = getPlatformCredentials();
  if (!creds) {
    console.log(`[whatsapp:mock] Would send platform WhatsApp message to ${to} (WHATSAPP_PLATFORM_* not configured)`);
    return { delivered: false, mode: "mock" };
  }
  return callWhatsAppApi(creds, to, body);
}
