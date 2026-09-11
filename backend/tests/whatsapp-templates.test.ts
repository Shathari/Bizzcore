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
      components: [
        {
          type: "BODY",
          text: "Your order {{1}} is confirmed.",
          example: { body_text: [["Sample 1"]] },
        },
      ],
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

describe("whatsapp templates: POST /api/whatsapp/templates — variable/placeholder validation", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseFields = { name: "order_confirmation", category: "UTILITY" as const, language: "en_US" };

  async function connectedTenant(suffix: string) {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, {
      phoneNumberId: `phone-${suffix}`,
      wabaId: `waba-${suffix}`,
      accessToken: `token-${suffix}`,
    });
    return { cookie: await loginAs(admin.email) };
  }

  async function post(cookie: string, bodyText: string) {
    return request(app)
      .post("/api/whatsapp/templates")
      .set("Cookie", cookie)
      .send({ ...baseFields, bodyText });
  }

  // --- valid bodies -------------------------------------------------------

  it("accepts a body with no variables and sends no example object", async () => {
    const { cookie } = await connectedTenant("v1");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-v1", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, "Thanks for shopping with us!");
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const component = JSON.parse(init.body as string).components[0];
    expect(component).toEqual({ type: "BODY", text: "Thanks for shopping with us!" });
    expect(component.example).toBeUndefined();
  });

  it("accepts a single sequential variable and generates a matching 1-item example.body_text", async () => {
    const { cookie } = await connectedTenant("v2");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-v2", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, "Hi {{1}}, thanks for your order!");
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const component = JSON.parse(init.body as string).components[0];
    expect(component.example).toEqual({ body_text: [["Sample 1"]] });
  });

  it("accepts multiple sequential variables and generates one sample per variable, in order", async () => {
    const { cookie } = await connectedTenant("v3");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-v3", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, "Hi {{1}}, your order {{2}} shipped and arrives on {{3}}.");
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const component = JSON.parse(init.body as string).components[0];
    expect(component.example).toEqual({ body_text: [["Sample 1", "Sample 2", "Sample 3"]] });
  });

  it("accepts a repeated variable without treating the repeat as a sequence break", async () => {
    const { cookie } = await connectedTenant("v4");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-v4", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, "Hi {{1}}, {{1}} — your order {{2}} is on its way.");
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const component = JSON.parse(init.body as string).components[0];
    // 2 distinct variables ({{1}}, {{2}}) => 2 samples, despite {{1}} appearing twice.
    expect(component.example).toEqual({ body_text: [["Sample 1", "Sample 2"]] });
  });

  // --- invalid brace syntax -------------------------------------------------

  it("rejects a placeholder with internal spaces", async () => {
    const { cookie } = await connectedTenant("i1");
    const res = await post(cookie, "Hi {{ 1 }}, thanks for your order!");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid placeholder/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric placeholder", async () => {
    const { cookie } = await connectedTenant("i2");
    const res = await post(cookie, "Hi {{name}}, thanks for your order!");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid placeholder/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a placeholder mixing digits and letters", async () => {
    const { cookie } = await connectedTenant("i3");
    const res = await post(cookie, "Hi {{1a}}, thanks for your order!");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid placeholder/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- invalid sequencing ----------------------------------------------------

  it("rejects a body whose first variable doesn't start at {{1}}", async () => {
    const { cookie } = await connectedTenant("s1");
    const res = await post(cookie, "Your code is {{2}}.");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start at \{\{1\}\}/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a body with a gap in variable numbering", async () => {
    const { cookie } = await connectedTenant("s2");
    const res = await post(cookie, "Hi {{1}}, your order {{3}} shipped.");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sequentially/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a body whose variables appear out of order", async () => {
    const { cookie } = await connectedTenant("s3");
    const res = await post(cookie, "Order {{2}} for {{1}} has shipped.");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sequentially/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- structural placement ---------------------------------------------

  it("rejects a body that starts directly with a variable", async () => {
    const { cookie } = await connectedTenant("p1");
    const res = await post(cookie, "{{1}} thanks for your order!");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't start directly with a variable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a body that ends directly with a variable", async () => {
    const { cookie } = await connectedTenant("p2");
    const res = await post(cookie, "Thanks for your order, {{1}}");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't end directly with a variable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects two variables placed side-by-side with no static text between them", async () => {
    const { cookie } = await connectedTenant("p3");
    const res = await post(cookie, "Your codes: {{1}}{{2}} — keep them safe.");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't sit next to each other/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects two variables separated only by whitespace", async () => {
    const { cookie } = await connectedTenant("p4");
    const res = await post(cookie, "Your codes: {{1}}   {{2}} — keep them safe.");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't sit next to each other/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("whatsapp templates: POST /api/whatsapp/templates — HEADER support", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseFields = {
    name: "order_confirmation",
    category: "UTILITY" as const,
    language: "en_US",
    bodyText: "Thanks for your order!",
  };

  async function connectedTenant(suffix: string) {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, {
      phoneNumberId: `phone-h-${suffix}`,
      wabaId: `waba-h-${suffix}`,
      accessToken: `token-h-${suffix}`,
    });
    return { cookie: await loginAs(admin.email) };
  }

  function post(cookie: string, header: Record<string, unknown>) {
    return request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send({ ...baseFields, header });
  }

  it("accepts a static TEXT header (no variable) and sends no example", async () => {
    const { cookie } = await connectedTenant("h1");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-h1", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, { format: "TEXT", text: "Order update" });
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const header = JSON.parse(init.body as string).components[0];
    expect(header).toEqual({ type: "HEADER", format: "TEXT", text: "Order update" });
  });

  it("accepts a TEXT header with {{1}} and generates example.header_text", async () => {
    const { cookie } = await connectedTenant("h2");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-h2", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, { format: "TEXT", text: "Hi {{1}}" });
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const header = JSON.parse(init.body as string).components[0];
    expect(header).toEqual({
      type: "HEADER",
      format: "TEXT",
      text: "Hi {{1}}",
      example: { header_text: ["Sample Header Value"] },
    });
  });

  it("rejects a TEXT header with more than one variable", async () => {
    const { cookie } = await connectedTenant("h3");
    const res = await post(cookie, { format: "TEXT", text: "Hi {{1}}, order {{2}}" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only one variable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a TEXT header whose variable isn't {{1}}", async () => {
    const { cookie } = await connectedTenant("h4");
    const res = await post(cookie, { format: "TEXT", text: "Hi {{2}}" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be \{\{1\}\}/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a TEXT header with malformed placeholder syntax", async () => {
    const { cookie } = await connectedTenant("h5");
    const res = await post(cookie, { format: "TEXT", text: "Hi {{ 1 }}" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid placeholder/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a TEXT header with no text", async () => {
    const { cookie } = await connectedTenant("h6");
    const res = await post(cookie, { format: "TEXT" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Header text is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["IMAGE", "DOCUMENT", "VIDEO"] as const)(
    "accepts a %s header with a sample media handle and sends example.header_handle",
    async (format) => {
      const { cookie } = await connectedTenant(`h7-${format}`);
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-h7", status: "PENDING", category: "UTILITY" }) } as Response);

      const res = await post(cookie, { format, mediaHandle: "4::abc123handle" });
      expect(res.status).toBe(201);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const header = JSON.parse(init.body as string).components[0];
      expect(header).toEqual({ type: "HEADER", format, example: { header_handle: ["4::abc123handle"] } });
    }
  );

  it("rejects a media header with no sample media handle", async () => {
    const { cookie } = await connectedTenant("h8");
    const res = await post(cookie, { format: "IMAGE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sample media handle is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("places HEADER before BODY in the components array", async () => {
    const { cookie } = await connectedTenant("h9");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-h9", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, { format: "TEXT", text: "Order update" });
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const components = JSON.parse(init.body as string).components;
    expect(components.map((c: { type: string }) => c.type)).toEqual(["HEADER", "BODY"]);
  });
});

describe("whatsapp templates: POST /api/whatsapp/templates — BUTTONS support", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseFields = {
    name: "order_confirmation",
    category: "UTILITY" as const,
    language: "en_US",
    bodyText: "Thanks for your order!",
  };

  async function connectedTenant(suffix: string) {
    const { tenant, admin } = await createTenantWithAdmin();
    await saveWhatsAppCredential(tenant.id, {
      phoneNumberId: `phone-b-${suffix}`,
      wabaId: `waba-b-${suffix}`,
      accessToken: `token-b-${suffix}`,
    });
    return { cookie: await loginAs(admin.email) };
  }

  function post(cookie: string, buttons: Record<string, unknown>[]) {
    return request(app).post("/api/whatsapp/templates").set("Cookie", cookie).send({ ...baseFields, buttons });
  }

  it("accepts a QUICK_REPLY button", async () => {
    const { cookie } = await connectedTenant("b1");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b1", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [{ type: "QUICK_REPLY", text: "Track order" }]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const buttonsComponent = JSON.parse(init.body as string).components.find((c: { type: string }) => c.type === "BUTTONS");
    expect(buttonsComponent).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Track order" }] });
  });

  it("accepts a PHONE_NUMBER button with an E.164 number", async () => {
    const { cookie } = await connectedTenant("b2");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b2", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [{ type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+14155552671" }]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const buttonsComponent = JSON.parse(init.body as string).components.find((c: { type: string }) => c.type === "BUTTONS");
    expect(buttonsComponent).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "PHONE_NUMBER", text: "Call us", phone_number: "+14155552671" }],
    });
  });

  it("rejects a PHONE_NUMBER button with a non-E.164 number", async () => {
    const { cookie } = await connectedTenant("b3");
    const res = await post(cookie, [{ type: "PHONE_NUMBER", text: "Call us", phoneNumber: "0123-456-7890" }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/E\.164/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a REQUEST_CONTACT_INFO button", async () => {
    const { cookie } = await connectedTenant("b4");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b4", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [{ type: "REQUEST_CONTACT_INFO", text: "Share contact" }]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const buttonsComponent = JSON.parse(init.body as string).components.find((c: { type: string }) => c.type === "BUTTONS");
    expect(buttonsComponent).toEqual({ type: "BUTTONS", buttons: [{ type: "REQUEST_CONTACT_INFO", text: "Share contact" }] });
  });

  it("accepts a static URL button (no variable) and sends no example", async () => {
    const { cookie } = await connectedTenant("b5");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b5", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [{ type: "URL", text: "Visit site", url: "https://bizzcore.in" }]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const buttonsComponent = JSON.parse(init.body as string).components.find((c: { type: string }) => c.type === "BUTTONS");
    expect(buttonsComponent).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: "Visit site", url: "https://bizzcore.in" }],
    });
  });

  it("accepts a dynamic URL button with a sample and generates the button's example array", async () => {
    const { cookie } = await connectedTenant("b6");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b6", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [
      { type: "URL", text: "Track order", url: "https://bizzcore.in/orders/{{1}}", urlExample: "12345" },
    ]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const buttonsComponent = JSON.parse(init.body as string).components.find((c: { type: string }) => c.type === "BUTTONS");
    expect(buttonsComponent).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: "Track order", url: "https://bizzcore.in/orders/{{1}}", example: ["12345"] }],
    });
  });

  it("rejects a dynamic URL button with no sample value", async () => {
    const { cookie } = await connectedTenant("b7");
    const res = await post(cookie, [{ type: "URL", text: "Track order", url: "https://bizzcore.in/orders/{{1}}" }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sample value is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a URL button with more than one variable", async () => {
    const { cookie } = await connectedTenant("b8");
    const res = await post(cookie, [
      { type: "URL", text: "Track", url: "https://bizzcore.in/{{1}}/{{2}}", urlExample: "x" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only one variable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a URL button whose variable isn't {{1}}", async () => {
    const { cookie } = await connectedTenant("b9");
    const res = await post(cookie, [
      { type: "URL", text: "Track", url: "https://bizzcore.in/orders/{{2}}", urlExample: "12345" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be \{\{1\}\}/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects more than one URL button", async () => {
    const { cookie } = await connectedTenant("b10");
    const res = await post(cookie, [
      { type: "URL", text: "Track", url: "https://bizzcore.in/a" },
      { type: "URL", text: "Shop", url: "https://bizzcore.in/b" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most one URL button/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects more than one PHONE_NUMBER button", async () => {
    const { cookie } = await connectedTenant("b11");
    const res = await post(cookie, [
      { type: "PHONE_NUMBER", text: "Call sales", phoneNumber: "+14155552671" },
      { type: "PHONE_NUMBER", text: "Call support", phoneNumber: "+14155552672" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most one phone number button/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects more than 10 buttons", async () => {
    const { cookie } = await connectedTenant("b12");
    const buttons = Array.from({ length: 11 }, (_, i) => ({ type: "QUICK_REPLY", text: `Option ${i + 1}` }));
    const res = await post(cookie, buttons);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 10 buttons/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty buttons array", async () => {
    const { cookie } = await connectedTenant("b13");
    const res = await post(cookie, []);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mixes multiple valid button types and sends BUTTONS after BODY", async () => {
    const { cookie } = await connectedTenant("b14");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: "tpl-b14", status: "PENDING", category: "UTILITY" }) } as Response);

    const res = await post(cookie, [
      { type: "QUICK_REPLY", text: "Track order" },
      { type: "URL", text: "Shop now", url: "https://bizzcore.in/shop/{{1}}", urlExample: "promo42" },
      { type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+14155552671" },
    ]);
    expect(res.status).toBe(201);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const components = JSON.parse(init.body as string).components;
    expect(components.map((c: { type: string }) => c.type)).toEqual(["BODY", "BUTTONS"]);
    expect(components[1].buttons).toEqual([
      { type: "QUICK_REPLY", text: "Track order" },
      { type: "URL", text: "Shop now", url: "https://bizzcore.in/shop/{{1}}", example: ["promo42"] },
      { type: "PHONE_NUMBER", text: "Call us", phone_number: "+14155552671" },
    ]);
  });
});
