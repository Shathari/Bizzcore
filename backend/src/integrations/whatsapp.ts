import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

export type WhatsAppResult = {
  delivered: boolean;
  mode: "live" | "mock";
  error?: string;
  // Meta's WAMID for this send, e.g. "wamid.HBg...". Only ever set on a
  // successful live send — used by callers (routes/communication.ts,
  // jobs/scheduler.ts) to stamp Message.externalId, which the webhook then
  // matches status-update events (delivered/read/failed) back against. See
  // schema.prisma's comment on Message.externalId for the full chain.
  externalId?: string;
};

// wabaId is optional on the credential type itself (a tenant that
// connected before this field existed, or hasn't filled it in on a re-save,
// still has a working phoneNumberId+accessToken) — only template management
// (routes/whatsappTemplates.ts) actually requires it to be present; sending
// a message never does.
type WhatsAppCredentials = { phoneNumberId: string; accessToken: string; wabaId?: string };

// What actually goes out over the wire — either a freeform text message
// (used for Communication Center replies/broadcasts, restricted by Meta to
// within a customer-initiated 24-hour window) or a template message
// (pre-approved by Meta, usable to open a conversation cold). bodyParams
// fills the template's {{1}}, {{2}}... placeholders in order, if it has any.
type OutboundMessage = { type: "text"; body: string } | { type: "template"; name: string; language: string; bodyParams?: string[] };

function messagePayload(to: string, message: OutboundMessage) {
  if (message.type === "text") {
    return { messaging_product: "whatsapp", to, type: "text", text: { body: message.body } };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: message.name,
      language: { code: message.language },
      ...(message.bodyParams?.length
        ? { components: [{ type: "body", parameters: message.bodyParams.map((text) => ({ type: "text", text })) }] }
        : {}),
    },
  };
}

async function callWhatsAppApi(creds: WhatsAppCredentials, to: string, message: OutboundMessage): Promise<WhatsAppResult> {
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messagePayload(to, message)),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { delivered: false, mode: "live", error: `WhatsApp API error ${resp.status}: ${text.slice(0, 200)}` };
    }
    // { messaging_product, contacts: [...], messages: [{ id: "wamid.xxx" }] }
    // — best-effort parse: a malformed/unexpected success body shouldn't
    // turn a message that Meta already accepted into a reported failure.
    let externalId: string | undefined;
    try {
      const json = (await resp.json()) as { messages?: Array<{ id?: string }> };
      externalId = json.messages?.[0]?.id;
    } catch {
      // leave externalId undefined
    }
    return { delivered: true, mode: "live", externalId };
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
//
// Exported (not just used internally) so routes/whatsappTemplates.ts can
// read the same tenant's wabaId + accessToken for Template Management API
// calls, without a second copy of this decrypt-and-parse logic.
export async function getTenantWhatsAppCredentials(tenantId: string): Promise<WhatsAppCredentials | null> {
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
  const creds = await getTenantWhatsAppCredentials(tenantId);
  if (!creds) {
    console.log(`[whatsapp:mock] Would send WhatsApp message to ${to} (no WhatsApp credentials configured for this tenant)`);
    return { delivered: false, mode: "mock" };
  }
  return callWhatsAppApi(creds, to, { type: "text", body });
}

function getPlatformCredentials(): WhatsAppCredentials | null {
  const phoneNumberId = process.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_PLATFORM_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

// The one and only thing sendPlatformWhatsAppMessage below sends — kept as
// a named, structured shape (not a pre-joined string) specifically so its
// four pieces can each become their own template variable ({{1}}..{{4}})
// when template mode is active, not just one opaque blob. If this function
// ever needs a second use case, that's a signal to add a second function,
// not to make this shape generic.
export type PlatformCredentialMessage = { businessName: string; email: string; tempPassword: string; loginUrl: string };

function freeformCredentialText(m: PlatformCredentialMessage): string {
  return `BizzCore: your login for ${m.businessName} is ready. Email: ${m.email}  Temp password: ${m.tempPassword}  Login: ${m.loginUrl}`;
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
// WhatsApp Cloud API restricts business-initiated messages to a recipient
// with no prior 24-hour customer-service window to APPROVED TEMPLATE
// messages — a first-ever contact with a new business owner's number
// (exactly this use case) is very likely to be rejected as freeform text.
// WHATSAPP_PLATFORM_TEMPLATE_NAME/_LANGUAGE opt into sending as a template
// instead, once one has actually been created and approved (see
// routes/whatsappTemplates.ts) — until then this keeps sending freeform
// text exactly as before, so setting up template management doesn't
// silently break existing credential delivery the moment it merges. In
// template mode, businessName/email/tempPassword/loginUrl map onto the
// template's {{1}}/{{2}}/{{3}}/{{4}} in that order — the registered
// template's approved body text needs exactly four placeholders in that
// order (see that env var's comment in .env.example for the exact
// expected wording).
export async function sendPlatformWhatsAppMessage(to: string, message: PlatformCredentialMessage): Promise<WhatsAppResult> {
  const creds = getPlatformCredentials();
  if (!creds) {
    console.log(`[whatsapp:mock] Would send platform WhatsApp message to ${to} (WHATSAPP_PLATFORM_* not configured)`);
    return { delivered: false, mode: "mock" };
  }
  const templateName = process.env.WHATSAPP_PLATFORM_TEMPLATE_NAME;
  const templateLanguage = process.env.WHATSAPP_PLATFORM_TEMPLATE_LANGUAGE;
  const outbound: OutboundMessage =
    templateName && templateLanguage
      ? {
          type: "template",
          name: templateName,
          language: templateLanguage,
          bodyParams: [message.businessName, message.email, message.tempPassword, message.loginUrl],
        }
      : { type: "text", body: freeformCredentialText(message) };
  return callWhatsAppApi(creds, to, outbound);
}
