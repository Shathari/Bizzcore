import { apiClient } from "./client";

export type WhatsAppTemplate = {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | ...
  category: string;
  language: string;
  // Raw BODY text with {{n}} tokens intact, and how many distinct variables
  // it has — used by the broadcast composer (Communication.tsx) to build
  // the placeholder-mapping form and render a live preview.
  bodyText: string | null;
  bodyVariableCount: number;
};

export type TemplatesStatus = {
  connected: boolean;
  // Distinct from `connected` — a WhatsApp connection saved before the WABA
  // ID field existed (or without one) can still send messages, but can't
  // manage templates until a WABA ID is added in Settings.
  wabaConfigured: boolean;
  templates: WhatsAppTemplate[];
};

export async function listWhatsAppTemplates(): Promise<TemplatesStatus> {
  const { data } = await apiClient.get<TemplatesStatus>("/whatsapp/templates");
  return data;
}

export async function createWhatsAppTemplate(input: {
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  bodyText: string;
}): Promise<{ id: string; status: string; category: string }> {
  const { data } = await apiClient.post("/whatsapp/templates", input);
  return data;
}
