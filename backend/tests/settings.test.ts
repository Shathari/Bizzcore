import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { decrypt } from "../src/lib/crypto";

describe("settings: integration credentials", () => {
  it("starts with both integrations not connected", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/settings/integrations").set("Cookie", cookie);
    expect(res.body.meta.connected).toBe(false);
    expect(res.body.whatsapp.connected).toBe(false);
  });

  it("requires either a Page ID or an Instagram Business Account ID for Meta", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/settings/integrations/meta")
      .set("Cookie", cookie)
      .send({ accessToken: "some-token" });
    expect(res.status).toBe(400);
  });

  it("encrypts the payload at rest — raw DB row contains no plaintext secret", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "phone-123", wabaId: "waba-123", accessToken: "SUPER-SECRET-TOKEN" });

    const record = await prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "WHATSAPP" } },
    });
    expect(record).not.toBeNull();
    expect(record!.encryptedPayload).not.toContain("SUPER-SECRET-TOKEN");
    expect(record!.encryptedPayload).not.toContain("phone-123");

    const decrypted = JSON.parse(decrypt(record!.encryptedPayload));
    expect(decrypted).toEqual({ phoneNumberId: "phone-123", wabaId: "waba-123", accessToken: "SUPER-SECRET-TOKEN" });
  });

  it("requires a WhatsApp Business Account ID — Template Management calls are scoped to it, not the phone number", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "phone-789", accessToken: "some-token" });
    expect(res.status).toBe(400);
  });

  it("returns the WABA ID back to the client — non-secret, unlike the access token", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "phone-999", wabaId: "waba-999", accessToken: "some-token" });

    const res = await request(app).get("/api/settings/integrations").set("Cookie", cookie);
    expect(res.body.whatsapp.wabaId).toBe("waba-999");
  });

  it("never returns the access token back to the client", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "phone-456", wabaId: "waba-456", accessToken: "another-secret" });

    const res = await request(app).get("/api/settings/integrations").set("Cookie", cookie);
    expect(res.body.whatsapp.hasAccessToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("another-secret");
  });

  it("keeps the existing token when the update omits it, while updating other fields", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "original-phone", wabaId: "original-waba", accessToken: "original-token" });

    // phoneNumberId and wabaId aren't write-only like accessToken — the
    // real Settings form always has them pre-filled from GET, so it always
    // resends both on every save; only accessToken is ever legitimately
    // omitted (its field starts blank since the real value is never sent
    // back to the client).
    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "updated-phone", wabaId: "updated-waba" });

    const record = await prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "WHATSAPP" } },
    });
    const decrypted = JSON.parse(decrypt(record!.encryptedPayload));
    expect(decrypted).toEqual({ phoneNumberId: "updated-phone", wabaId: "updated-waba", accessToken: "original-token" });
  });

  it("removes the credential on disconnect", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/meta")
      .set("Cookie", cookie)
      .send({ pageId: "page-1", accessToken: "token-1" });

    const deleteRes = await request(app).delete("/api/settings/integrations/meta").set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const record = await prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "META" } },
    });
    expect(record).toBeNull();
  });
});
