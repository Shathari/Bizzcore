import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTenantWithAdmin } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";
import { sendWhatsAppMessage } from "../src/integrations/whatsapp";
import { sendInstagramDirectMessage, publishInstagramPost, replyToInstagramComment } from "../src/integrations/instagram";
import { publishFacebookPost } from "../src/integrations/facebook";
import { sendSms } from "../src/integrations/sms";

async function saveMetaCredential(tenantId: string, payload: object) {
  await prisma.integrationCredential.create({
    data: { tenantId, provider: "META", encryptedPayload: encrypt(JSON.stringify(payload)) },
  });
}

async function saveWhatsAppCredential(tenantId: string, payload: object) {
  await prisma.integrationCredential.create({
    data: { tenantId, provider: "WHATSAPP", encryptedPayload: encrypt(JSON.stringify(payload)) },
  });
}

describe("integrations: mock-first adapters", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.SMS_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  it("whatsapp: runs in mock mode when no tenant credential exists", async () => {
    const { tenant } = await createTenantWithAdmin();
    const result = await sendWhatsAppMessage(tenant.id, "+919800000060", "hello");
    expect(result).toEqual({ delivered: false, mode: "mock" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("whatsapp: attempts a live call with the correct request shape when configured", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-999", accessToken: "wa-token" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await sendWhatsAppMessage(tenant.id, "+919800000061", "hi there");
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("phone-999/messages");
    expect(init.headers).toMatchObject({ Authorization: "Bearer wa-token" });
    expect(JSON.parse(init.body as string)).toMatchObject({ to: "+919800000061", type: "text" });
  });

  it("whatsapp: surfaces a live delivery failure instead of silently succeeding", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-999", accessToken: "wa-token" });
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid token" } as Response);

    const result = await sendWhatsAppMessage(tenant.id, "+919800000062", "hi");
    expect(result.delivered).toBe(false);
    expect(result.mode).toBe("live");
    expect(result.error).toContain("401");
  });

  it("instagram: DM send runs in mock mode without a tenant credential", async () => {
    const { tenant } = await createTenantWithAdmin();
    const result = await sendInstagramDirectMessage(tenant.id, "ig-user-1", "hi");
    expect(result).toEqual({ delivered: false, mode: "mock" });
  });

  it("instagram: publishes a post live with the correct two-step container+publish calls", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveMetaCredential(tenant.id, { igBusinessAccountId: "ig-biz-1", accessToken: "meta-token" });
    fetchSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "container-123" }) } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);

    const result = await publishInstagramPost(tenant.id, "https://example.com/photo.jpg", "New arrival!", "POST");
    expect(result).toEqual({ delivered: true, mode: "live" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [containerUrl] = fetchSpy.mock.calls[0] as [string];
    const [publishUrl, publishInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(containerUrl).toContain("ig-biz-1/media");
    expect(publishUrl).toContain("ig-biz-1/media_publish");
    expect(JSON.parse(publishInit.body as string)).toEqual({ creation_id: "container-123" });
  });

  it("instagram: comment reply always runs in mock mode without a real externalCommentId (no webhook ingestion in this build)", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveMetaCredential(tenant.id, { igBusinessAccountId: "ig-biz-1", accessToken: "meta-token" });

    const result = await replyToInstagramComment(tenant.id, null, "thanks!");
    expect(result).toEqual({ delivered: false, mode: "mock" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("facebook: publishes a text-only post to /feed when no media is provided", async () => {
    const { tenant } = await createTenantWithAdmin();
    await saveMetaCredential(tenant.id, { pageId: "page-1", accessToken: "meta-token" });
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await publishFacebookPost(tenant.id, null, "Text-only update");
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("page-1/feed");
    expect(JSON.parse(init.body as string)).toEqual({ message: "Text-only update" });
  });

  it("sms: runs in mock mode when the selected provider has no credentials", async () => {
    process.env.SMS_PROVIDER = "twilio";
    const result = await sendSms({ to: "+919800000070", body: "hi" });
    expect(result).toEqual({ delivered: false, mode: "mock" });
  });

  it("sms: dispatches to the correct provider based on SMS_PROVIDER", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC-fake";
    process.env.TWILIO_AUTH_TOKEN = "fake-token";
    process.env.TWILIO_FROM_NUMBER = "+15005550006";
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" } as Response);

    const result = await sendSms({ to: "+919800000071", body: "hi via twilio" });
    expect(result).toEqual({ delivered: true, mode: "live" });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain("api.twilio.com");
  });
});
