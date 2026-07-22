import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

export type WhatsAppResult = { delivered: boolean; mode: "live" | "mock"; error?: string };

type WhatsAppCredentials = { phoneNumberId: string; accessToken: string };

// Unlike email.ts/sms.ts (platform-level, env-configured — BizzCore's own
// transactional delivery), WhatsApp is a per-tenant integration: each
// boutique has its own WhatsApp Business number. Credentials live encrypted
// in IntegrationCredential, entered by the tenant admin via Settings (not
// yet built) — until a tenant has configured one, every send here runs in
// mock mode.
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
