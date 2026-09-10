import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";

async function saveWhatsAppCredential(
  tenantId: string,
  payload: { phoneNumberId: string; wabaId?: string; accessToken: string }
) {
  await prisma.integrationCredential.create({
    data: {
      tenantId,
      provider: "WHATSAPP",
      encryptedPayload: encrypt(JSON.stringify(payload)),
      externalId: payload.phoneNumberId,
      wabaId: payload.wabaId ?? null,
    },
  });
}

describe("whatsapp templates: GET /api/whatsapp/templates", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/whatsapp/templates");
    expect(res.status).toBe(401);
  });

  it("reports not connected when the tenant has no WhatsApp credential at all", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/whatsapp/templates").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, wabaConfigured: false, templates: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports connected-but-not-waba-configured for a pre-existing connection with no WABA ID", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-1", accessToken: "token-1" });
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/whatsapp/templates").set("Cookie", cookie);
    expect(res.body).toEqual({ connected: true, wabaConfigured: false, templates: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the tenant's own WABA templates live from Meta", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-2", wabaId: "waba-2", accessToken: "token-2" });
    const cookie = await loginAs(admin.email);

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "tpl-1", name: "order_update", status: "APPROVED", category: "UTILITY", language: "en_US" }],
      }),
    } as Response);

    const res = await request(app).get("/api/whatsapp/templates").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.wabaConfigured).toBe(true);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.templates[0]).toMatchObject({ name: "order_update", status: "APPROVED" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("waba-2/message_templates");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-2" });
  });

  it("surfaces a Meta API error as 502 instead of a raw 200", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-3", wabaId: "waba-3", accessToken: "bad-token" });
    const cookie = await loginAs(admin.email);

    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    } as Response);

    const res = await request(app).get("/api/whatsapp/templates").set("Cookie", cookie);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Invalid OAuth access token");
  });

  it("never lets tenant A's request use tenant B's WABA/token", async () => {
    const { tenant: tenantA, admin: adminA } = await createTenantWithAdmin("Tenant A7");
    const { tenant: tenantB } = await createTenantWithAdmin("Tenant B7");
    await saveWhatsAppCredential(tenantA.id, { phoneNumberId: "phone-a", wabaId: "waba-a", accessToken: "token-a" });
    await saveWhatsAppCredential(tenantB.id, { phoneNumberId: "phone-b", wabaId: "waba-b", accessToken: "token-b" });
    const cookieA = await loginAs(adminA.email);

    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);

    await request(app).get("/api/whatsapp/templates").set("Cookie", cookieA);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("waba-a/message_templates");
    expect(url).not.toContain("waba-b");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-a" });
  });
});

describe("whatsapp templates: POST /api/whatsapp/templates", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const validBody = { name: "order_confirmation", category: "UTILITY", language: "en_US", bodyText: "Your order {{1}} is confirmed." };

  it("rejects a template name with uppercase/spaces (Meta's naming rule)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-4", wabaId: "waba-4", accessToken: "token-4" });
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/whatsapp/templates")
      .set("Cookie", cookie)
      .send({ ...validBody, name: "Order Confirmation" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid category", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-5", wabaId: "waba-5", accessToken: "token-5" });
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/whatsapp/templates")
      .set("Cookie", cookie)
      .send({ ...validBody, category: "PROMOTIONAL" });
    expect(res.status).toBe(400);
  });

  it("blocks creation when WhatsApp isn't connected at all", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send(validBody);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks creation when connected but no WABA ID is configured", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-6", accessToken: "token-6" });
    const cookie = await loginAs(admin.email);

    const res = await request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send(validBody);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates a template against the tenant's own WABA with the correct request shape", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-7", wabaId: "waba-7", accessToken: "token-7" });
    const cookie = await loginAs(admin.email);

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "tpl-new-1", status: "PENDING", category: "UTILITY" }),
    } as Response);

    const res = await request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "tpl-new-1", status: "PENDING", category: "UTILITY" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("waba-7/message_templates");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-7", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      name: "order_confirmation",
      category: "UTILITY",
      language: "en_US",
      components: [{ type: "BODY", text: "Your order {{1}} is confirmed." }],
    });
  });

  it("surfaces a Meta rejection (e.g. duplicate name) as 502 with Meta's own message", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, { phoneNumberId: "phone-8", wabaId: "waba-8", accessToken: "token-8" });
    const cookie = await loginAs(admin.email);

    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "A template with this name already exists" } }),
    } as Response);

    const res = await request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("A template with this name already exists");
  });
});
