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

export async function saveWhatsAppCredentials(input: { phoneNumberId: string; accessToken?: string }): Promise<void> {
  await apiClient.put("/settings/integrations/whatsapp", input);
}

export async function disconnectWhatsApp(): Promise<void> {
  await apiClient.delete("/settings/integrations/whatsapp");
}
