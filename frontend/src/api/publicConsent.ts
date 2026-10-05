import { apiClient } from "./client";

// Unauthenticated — same trust model as the token itself (see backend's
// routes/publicConsent.ts). Only ever called from pages/public/ConsentPage.tsx.

export async function getConsentPageInfo(token: string): Promise<{ businessName: string } | null> {
  try {
    const { data } = await apiClient.get<{ businessName: string }>(`/public/consent/${token}`);
    return data;
  } catch {
    return null;
  }
}

export async function submitConsentChoice(token: string, phone: string, choice: "YES" | "NO"): Promise<"OPTED_IN" | "OPTED_OUT"> {
  const { data } = await apiClient.post<{ ok: true; status: "OPTED_IN" | "OPTED_OUT" }>(`/public/consent/${token}`, {
    phone,
    choice,
  });
  return data.status;
}
