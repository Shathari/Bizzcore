import { apiClient } from "./client";

export type MetaStatus = {
  connected: boolean;
  appId: string | null;
  pageId: string | null;
  igBusinessAccountId: string | null;
  hasAccessToken: boolean;
  updatedAt: string | null;
};

export type WhatsAppStatus = {
  connected: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  hasAccessToken: boolean;
  updatedAt: string | null;
};

export async function getIntegrations(): Promise<{ meta: MetaStatus; whatsapp: WhatsAppStatus }> {
  const { data } = await apiClient.get<{ meta: MetaStatus; whatsapp: WhatsAppStatus }>("/settings/integrations");
  return data;
}

export async function saveMetaCredentials(input: {
  appId?: string;
  pageId?: string;
  igBusinessAccountId?: string;
  accessToken?: string;
}): Promise<void> {
  await apiClient.put("/settings/integrations/meta", input);
}

export async function disconnectMeta(): Promise<void> {
  await apiClient.delete("/settings/integrations/meta");
}

export async function saveWhatsAppCredentials(input: {
  phoneNumberId: string;
  wabaId: string;
  accessToken?: string;
}): Promise<void> {
  await apiClient.put("/settings/integrations/whatsapp", input);
}

export async function disconnectWhatsApp(): Promise<void> {
  await apiClient.delete("/settings/integrations/whatsapp");
}

// Channel 3 (customer self-service opt-in QR code) — the token itself, not
// its rendered QR image; the Settings page builds the public URL and
// renders the QR client-side from it.
export async function getConsentPageToken(): Promise<string | null> {
  const { data } = await apiClient.get<{ token: string | null }>("/settings/consent-page");
  return data.token;
}

// Replaces any existing token with a new one in one step — the previous QR
// code stops working the instant this returns.
export async function regenerateConsentPageToken(): Promise<string> {
  const { data } = await apiClient.post<{ token: string }>("/settings/consent-page/regenerate");
  return data.token;
}

// Sets the token to null with no replacement — distinct from regenerate:
// this leaves no active link at all until the tenant generates a new one.
export async function revokeConsentPageToken(): Promise<void> {
  await apiClient.post("/settings/consent-page/revoke");
}
