import { apiClient } from "./client";

export const CONTENT_TYPES = [
  "Instagram Caption",
  "Facebook Post",
  "WhatsApp Message",
  "Festival Wish",
  "Product Description",
  "SEO Title",
  "Hashtags",
  "Ad Copy",
  "Best Posting Time",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const TONES = ["Elegant", "Playful", "Traditional", "Bold", "Minimal"] as const;
export type Tone = (typeof TONES)[number];

export type AIGeneration = {
  id: string;
  contentType: ContentType;
  tone: Tone;
  productName: string | null;
  context: string | null;
  output: string;
  createdAt: string;
};

export async function generateContent(input: {
  contentType: ContentType;
  tone: Tone;
  productName?: string;
  context?: string;
}): Promise<AIGeneration> {
  const { data } = await apiClient.post<AIGeneration>("/ai/generate", input);
  return data;
}

export async function listGenerations(): Promise<AIGeneration[]> {
  const { data } = await apiClient.get<AIGeneration[]>("/ai/generations");
  return data;
}

export async function getAIStatus(): Promise<{ configured: boolean }> {
  const { data } = await apiClient.get<{ configured: boolean }>("/ai/status");
  return data;
}
