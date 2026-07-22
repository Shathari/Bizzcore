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
      .send({ phoneNumberId: "phone-123", accessToken: "SUPER-SECRET-TOKEN" });

    const record = await prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "WHATSAPP" } },
    });
    expect(record).not.toBeNull();
    expect(record!.encryptedPayload).not.toContain("SUPER-SECRET-TOKEN");
    expect(record!.encryptedPayload).not.toContain("phone-123");

    const decrypted = JSON.parse(decrypt(record!.encryptedPayload));
    expect(decrypted).toEqual({ phoneNumberId: "phone-123", accessToken: "SUPER-SECRET-TOKEN" });
  });

  it("never returns the access token back to the client", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "phone-456", accessToken: "another-secret" });

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
      .send({ phoneNumberId: "original-phone", accessToken: "original-token" });

    await request(app)
      .put("/api/settings/integrations/whatsapp")
      .set("Cookie", cookie)
      .send({ phoneNumberId: "updated-phone" });

    const record = await prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "WHATSAPP" } },
    });
    const decrypted = JSON.parse(decrypt(record!.encryptedPayload));
    expect(decrypted).toEqual({ phoneNumberId: "updated-phone", accessToken: "original-token" });
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
