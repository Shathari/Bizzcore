import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

// Instagram and Facebook share one Meta credential row per tenant — in
// Meta's own account model, a Page and its linked IG Business Account sit
// under the same Business app / access token, matching the Settings spec
// ("Meta (Instagram/Facebook Graph API — App ID, Page/IG Business Account,
// access token)").
export type MetaCredentials = {
  appId?: string;
  pageId?: string;
  igBusinessAccountId?: string;
  accessToken: string;
};

export async function getTenantMetaCredentials(tenantId: string): Promise<MetaCredentials | null> {
  const record = await prisma.integrationCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider: "META" } },
  });
  if (!record) return null;
  try {
    return JSON.parse(decrypt(record.encryptedPayload)) as MetaCredentials;
  } catch {
    return null;
  }
}
