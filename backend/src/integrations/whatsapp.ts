import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { countDistinctVariables } from "../lib/whatsappPlaceholders";
import { normalizePhone } from "../lib/piiCrypto";
import { logger } from "../lib/logger";
import { isWhatsAppMessageId, safeMetaError } from "../lib/whatsappDiagnostics";

export type WhatsAppResult = {
  accepted: boolean;
  // Compatibility alias for existing reply/platform callers. Means accepted,
  // never delivered; broadcast dispatch uses accepted explicitly.
  delivered: boolean;
  mode: "live" | "mock";
  error?: string;
  // Meta's WAMID for this send, e.g. "wamid.HBg...". Only ever set on a
  // successful live send — used by callers (routes/communication.ts,
  // jobs/scheduler.ts) to stamp Message.externalId, which the webhook then
  // matches status-update events (delivered/read/failed) back against. See
  // schema.prisma's comment on Message.externalId for the full chain.
  externalId?: string;
  category?: string;
  httpStatus?: number;
  failureCode?: number;
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
  // Preserve country-code-as-entered conventions. Reject unsupported input
  // before stripping permitted formatting; never infer a missing country code.
  const recipient = normalizePhone(to);
  const diagnostic = message.type === "template" ? { templateName: message.name, templateLanguage: message.language } : {};
  const failure = (category: string, httpStatus?: number, meta: Partial<ReturnType<typeof safeMetaError>> = {}) => {
    logger.warn({ event: "whatsapp.send_result", ...diagnostic, category, httpStatus, ...meta }, "WhatsApp send not accepted");
    return { accepted: false, delivered: false, mode: "live" as const, error: category, category, httpStatus, failureCode: meta.failureCode };
  };
  if (!/^\+?[\d\s().-]+$/.test(to.trim()) || !/^[1-9]\d{6,14}$/.test(recipient)) return failure("INVALID_RECIPIENT_PHONE");
  logger.info({ event: "whatsapp.send_attempt", ...diagnostic }, "WhatsApp API request starting");
  try {
    const resp = await fetch(`https://graph.facebook.com/${apiVersion}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messagePayload(recipient, message)),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => null) as { error?: unknown } | null;
      return failure("META_REJECTED", resp.status, safeMetaError(json?.error));
    }
    const json = await resp.json().catch(() => null) as { messages?: Array<{ id?: unknown }> } | null;
    const externalId: unknown = Array.isArray(json?.messages) ? json.messages[0]?.id : undefined;
    if (!isWhatsAppMessageId(externalId)) return failure("META_INVALID_SUCCESS_RESPONSE", resp.status);
    logger.info({ event: "whatsapp.send_result", ...diagnostic, category: "META_ACCEPTED", httpStatus: resp.status, externalId }, "WhatsApp send accepted by Meta");
    return { accepted: true, delivered: true, mode: "live", externalId, category: "META_ACCEPTED", httpStatus: resp.status };
  } catch {
    return failure("META_NETWORK_ERROR");
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

// A tenant's own Meta-approved templates, with each one's BODY text and
// variable count already extracted — used by routes/whatsappTemplates.ts
// (the template list view) and routes/communication.ts (the broadcast
// composer's placeholder detection + server-side validation), so the one
// Graph API call and one parse live here instead of twice.
export type WhatsAppTemplateSummary = {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | ...
  category: string;
  language: string;
  // Raw BODY text with {{n}} tokens intact — null when the template has no
  // BODY component (shouldn't happen in practice; Meta requires one).
  bodyText: string | null;
  bodyVariableCount: number;
};

type MetaTemplateComponent = { type: string; format?: string; text?: string };
type MetaTemplateRaw = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components?: MetaTemplateComponent[];
};
type MetaTemplatesListResponse = { error?: { message?: string }; data?: MetaTemplateRaw[] };

export async function fetchWabaTemplates(
  creds: Pick<WhatsAppCredentials, "accessToken"> & { wabaId: string }
): Promise<{ ok: true; templates: WhatsAppTemplateSummary[] } | { ok: false; error: string }> {
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v20.0";
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${apiVersion}/${creds.wabaId}/message_templates?fields=name,status,category,language,components&limit=100`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } }
    );
    const json = (await resp.json().catch(() => null)) as MetaTemplatesListResponse | null;
    if (!resp.ok) {
      return { ok: false, error: json?.error?.message ?? `WhatsApp API error ${resp.status}` };
    }
    const templates: WhatsAppTemplateSummary[] = (json?.data ?? []).map((t) => {
      const bodyText = t.components?.find((c) => c.type === "BODY")?.text ?? null;
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        category: t.category,
        language: t.language,
        bodyText,
        bodyVariableCount: bodyText ? countDistinctVariables(bodyText) : 0,
      };
    });
    return { ok: true, templates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach WhatsApp API" };
  }
}

export async function sendWhatsAppMessage(tenantId: string, to: string, body: string): Promise<WhatsAppResult> {
  const creds = await getTenantWhatsAppCredentials(tenantId);
  if (!creds) {
    logger.warn({ event: "whatsapp.send_result", tenantId, category: "WHATSAPP_NOT_CONFIGURED" }, "WhatsApp send skipped");
    return { accepted: false, delivered: false, mode: "mock", category: "WHATSAPP_NOT_CONFIGURED" };
  }
  return callWhatsAppApi(creds, to, { type: "text", body });
}

// Tenant-facing template send — used by jobs/scheduler.ts for a template-mode
// WHATSAPP_BROADCAST, one call per recipient with that recipient's own
// resolved bodyParams (see lib/whatsappPlaceholders.ts's resolvePlaceholders).
// Generalizes the bodyParams support sendPlatformWhatsAppMessage below
// already has, but against the tenant's own WhatsApp number/credentials
// instead of BizzCore's platform one.
export async function sendWhatsAppTemplateMessage(
  tenantId: string,
  to: string,
  templateName: string,
  templateLanguage: string,
  bodyParams?: string[]
): Promise<WhatsAppResult> {
  const creds = await getTenantWhatsAppCredentials(tenantId);
  if (!creds) {
    logger.warn({ event: "whatsapp.send_result", tenantId, templateName, templateLanguage, category: "WHATSAPP_NOT_CONFIGURED" }, "WhatsApp send skipped");
    return { accepted: false, delivered: false, mode: "mock", category: "WHATSAPP_NOT_CONFIGURED" };
  }
  return callWhatsAppApi(creds, to, { type: "template", name: templateName, language: templateLanguage, bodyParams });
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
    logger.warn({ event: "whatsapp.send_result", category: "WHATSAPP_PLATFORM_NOT_CONFIGURED" }, "Platform WhatsApp send skipped");
    return { accepted: false, delivered: false, mode: "mock", category: "WHATSAPP_PLATFORM_NOT_CONFIGURED" };
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
