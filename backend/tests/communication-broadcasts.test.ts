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

// Shapes a Meta message_templates list response with one template, mirroring
// what fetchWabaTemplates (integrations/whatsapp.ts) parses.
function metaTemplatesResponse(templates: Array<{ name: string; status: string; language: string; bodyText: string | null }>) {
  return {
    ok: true,
    json: async () => ({
      data: templates.map((t, i) => ({
        id: `tpl-${i}`,
        name: t.name,
        status: t.status,
        category: "UTILITY",
        language: t.language,
        components: t.bodyText ? [{ type: "BODY", text: t.bodyText }] : [],
      })),
    }),
  } as Response;
}

describe("whatsapp broadcasts: POST /api/communication/broadcasts — freeform (legacy) mode", () => {
  async function tenantWithCookie() {
    const { tenant, admin } = await createTenantWithAdmin();
    return { tenant, cookie: await loginAs(admin.email) };
  }

  it("creates a freeform broadcast without needing WhatsApp connected", async () => {
    const { cookie } = await tenantWithCookie();
    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send({ caption: "Hi {{name}}, thanks!", targetSegment: "Regular", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.caption).toBe("Hi {{name}}, thanks!");
    expect(res.body.templateName).toBeNull();
    expect(res.body.placeholderConfig).toBeNull();
  });

  it("rejects a broadcast with neither a message nor a template", async () => {
    const { cookie } = await tenantWithCookie();
    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send({ targetSegment: "Regular", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/write a message or choose/i);
  });
});

describe("whatsapp broadcasts: POST /api/communication/broadcasts — template mode", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function tenantWithConnection(suffix: string) {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, {
      phoneNumberId: `phone-${suffix}`,
      wabaId: `waba-${suffix}`,
      accessToken: `token-${suffix}`,
    });
    return { tenant, cookie: await loginAs(admin.email) };
  }

  function templateBroadcastBody(overrides: Record<string, unknown> = {}) {
    return {
      templateName: "order_dispatch_update",
      templateLanguage: "en_US",
      targetSegment: "Regular",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      ...overrides,
    };
  }

  it("rejects a template broadcast with a name but no language", async () => {
    const { cookie } = await tenantWithConnection("t1");
    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send({ templateName: "order_dispatch_update", targetSegment: "Regular", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/needs both a template name and its language/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a template broadcast when WhatsApp isn't connected", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).post("/api/communication/broadcasts").set("Cookie", cookie).send(templateBroadcastBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/connect whatsapp/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a template broadcast when the named template+language isn't found", async () => {
    const { cookie } = await tenantWithConnection("t2");
    fetchSpy.mockResolvedValue(metaTemplatesResponse([{ name: "other_template", status: "APPROVED", language: "en_US", bodyText: null }]));

    const res = await request(app).post("/api/communication/broadcasts").set("Cookie", cookie).send(templateBroadcastBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("rejects a template broadcast when the template isn't approved yet", async () => {
    const { cookie } = await tenantWithConnection("t3");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([{ name: "order_dispatch_update", status: "PENDING", language: "en_US", bodyText: "Hi {{1}}" }])
    );

    const res = await request(app).post("/api/communication/broadcasts").set("Cookie", cookie).send(templateBroadcastBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/is pending, not approved/i);
  });

  it("creates a template broadcast with a fully mapped placeholder set", async () => {
    const { tenant, cookie } = await tenantWithConnection("t4");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([
        { name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Hi {{1}}, your order shipped on {{2}}." },
      ])
    );

    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(
        templateBroadcastBody({
          placeholders: [
            { index: 1, mode: "CUSTOMER_FIELD", field: "name" },
            { index: 2, mode: "STATIC", value: "our Diwali Sale" },
          ],
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.templateName).toBe("order_dispatch_update");
    expect(res.body.templateLanguage).toBe("en_US");
    expect(res.body.caption).toBe("Hi {{1}}, your order shipped on {{2}}.");

    const row = await prisma.scheduledContent.findUnique({ where: { id: res.body.id } });
    expect(row?.tenantId).toBe(tenant.id);
    expect(JSON.parse(row!.placeholderConfig!)).toEqual([
      { index: 1, mode: "CUSTOMER_FIELD", field: "name" },
      { index: 2, mode: "STATIC", value: "our Diwali Sale" },
    ]);
  });

  it("creates a template broadcast for a variable-free template with no placeholderConfig", async () => {
    const { cookie } = await tenantWithConnection("t5");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([{ name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Thanks for shopping with us!" }])
    );

    const res = await request(app).post("/api/communication/broadcasts").set("Cookie", cookie).send(templateBroadcastBody());
    expect(res.status).toBe(201);
    expect(res.body.placeholderConfig).toBeNull();
  });

  it("rejects a template broadcast missing a mapping for one of the template's placeholders", async () => {
    const { cookie } = await tenantWithConnection("t6");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([
        { name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Hi {{1}}, your order shipped on {{2}}." },
      ])
    );

    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(templateBroadcastBody({ placeholders: [{ index: 1, mode: "CUSTOMER_FIELD", field: "name" }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\{\{2\}\} needs a mapping/i);
  });

  it("rejects a template broadcast with a duplicate placeholder index", async () => {
    const { cookie } = await tenantWithConnection("t7");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([{ name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Hi {{1}}, order {{2}}." }])
    );

    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(
        templateBroadcastBody({
          placeholders: [
            { index: 1, mode: "CUSTOMER_FIELD", field: "name" },
            { index: 1, mode: "STATIC", value: "x" },
          ],
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only be mapped once/i);
  });

  it("rejects a template broadcast with a placeholder index out of range", async () => {
    const { cookie } = await tenantWithConnection("t8");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([{ name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Hi {{1}}." }])
    );

    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(
        templateBroadcastBody({
          placeholders: [
            { index: 1, mode: "CUSTOMER_FIELD", field: "name" },
            { index: 2, mode: "STATIC", value: "x" },
          ],
        })
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only has 1 placeholder/i);
  });

  it("rejects an empty static placeholder value", async () => {
    const { cookie } = await tenantWithConnection("t9");
    fetchSpy.mockResolvedValue(
      metaTemplatesResponse([{ name: "order_dispatch_update", status: "APPROVED", language: "en_US", bodyText: "Hi {{1}}." }])
    );

    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(templateBroadcastBody({ placeholders: [{ index: 1, mode: "STATIC", value: "   " }] }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown customer field mapping", async () => {
    const { cookie } = await tenantWithConnection("t10");
    const res = await request(app)
      .post("/api/communication/broadcasts")
      .set("Cookie", cookie)
      .send(templateBroadcastBody({ placeholders: [{ index: 1, mode: "CUSTOMER_FIELD", field: "notes" }] }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
