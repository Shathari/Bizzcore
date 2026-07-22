import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, grantPermissivePlan, configureIntegration } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Mocks the `openai` package exactly like ai.test.ts — this file also
// exercises POST /api/ai/generate, so it needs the same fake client.
vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Mock generated copy." } }],
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

async function assignPlan(tenantId: string, planName: string) {
  const plan = await prisma.plan.findFirstOrThrow({ where: { name: planName } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id } });
  return plan;
}

describe("entitlement enforcement — live blocking, not just effective-value math", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // --- AI generation (monthly counter, checked before the paid call, spent only on success) ---

  it("blocks AI generation once the monthly limit is reached, and never spends a unit on the blocking call itself", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { tenant, admin } = await createTenantWithAdmin();
    const plan = await assignPlan(tenant.id, "Starter AI"); // AI_CONTENT_GENERATION = 100
    await prisma.tenantFeatureOverride.create({
      data: { tenantId: tenant.id, featureKey: "AI_CONTENT_GENERATION", value: "2" }, // tighten to 2 for a fast test
    });
    const cookie = await loginAs(admin.email);

    const first = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(second.status).toBe(201);

    const blocked = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("USAGE_LIMIT_REACHED");
    expect(blocked.body.error).toMatch(/2\/2/);

    // The block itself didn't spend a unit or create a generation row.
    const count = await prisma.aIGeneration.count({ where: { tenantId: tenant.id } });
    expect(count).toBe(2);

    const usage = await request(app).get("/api/ai/usage").set("Cookie", cookie);
    expect(usage.body).toMatchObject({ included: true, used: 2, limit: 2 });

    void plan;
  });

  it("blocks AI generation entirely (not_included) for a tenant with no plan at all", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FEATURE_NOT_INCLUDED");
  });

  it("never blocks an unlimited-value feature, even after many generations", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Enterprise / Business OS"); // AI_CONTENT_GENERATION = unlimited
    const cookie = await loginAs(admin.email);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
      expect(res.status).toBe(201);
    }

    const usage = await request(app).get("/api/ai/usage").set("Cookie", cookie);
    expect(usage.body).toMatchObject({ included: true, limit: "unlimited" });
  });

  it("an active add-on top-up raises the effective ceiling past the plan's own value", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Starter AI"); // AI_CONTENT_GENERATION = 100
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureKey: "AI_CONTENT_GENERATION", value: "1" } });
    const addOn = await prisma.addOn.findFirstOrThrow({ where: { name: "Extra AI Generations (1,000)" } });
    await prisma.tenantAddOn.create({ data: { tenantId: tenant.id, addOnId: addOn.id, quantity: 1, status: "Active" } });
    const cookie = await loginAs(admin.email);

    // Override says 1, but the add-on adds 1000 on top — 2 calls should both succeed.
    const first = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    expect(second.status).toBe(201);
  });

  // --- WhatsApp messages (direct reply, monthly counter) ---

  it("blocks a WhatsApp conversation reply once the monthly message limit is reached", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Starter AI"); // WHATSAPP_MESSAGES = 200
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureKey: "WHATSAPP_MESSAGES", value: "1" } });
    const cookie = await loginAs(admin.email);

    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WHATSAPP", contactHandle: "+919800000099" },
    });

    const first = await request(app)
      .post(`/api/communication/conversations/${conversation.id}/messages`)
      .set("Cookie", cookie)
      .send({ body: "Hello!" });
    expect(first.status).toBe(201);

    const blocked = await request(app)
      .post(`/api/communication/conversations/${conversation.id}/messages`)
      .set("Cookie", cookie)
      .send({ body: "Are you there?" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("USAGE_LIMIT_REACHED");
    expect(blocked.body.featureKey).toBe("WHATSAPP_MESSAGES");

    // Blocked reply never got persisted as a Message row.
    const messages = await prisma.message.count({ where: { conversationId: conversation.id } });
    expect(messages).toBe(1);
  });

  it("does not meter a WEBSITE_CHAT reply — only WHATSAPP is a metered channel", async () => {
    const { tenant, admin } = await createTenantWithAdmin(); // no plan at all — WHATSAPP_MESSAGES not_included
    const cookie = await loginAs(admin.email);
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, channel: "WEBSITE_CHAT", contactHandle: null },
    });

    const res = await request(app)
      .post(`/api/communication/conversations/${conversation.id}/messages`)
      .set("Cookie", cookie)
      .send({ body: "Hi there" });
    expect(res.status).toBe(201);
  });

  // --- Scheduled posts (monthly counter) ---

  it("blocks scheduling a social post once the monthly limit is reached", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Starter AI"); // SCHEDULED_POSTS = 100
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureKey: "SCHEDULED_POSTS", value: "1" } });
    const cookie = await loginAs(admin.email);

    const first = await request(app)
      .post("/api/social/posts")
      .set("Cookie", cookie)
      .field("channel", "INSTAGRAM")
      .field("scheduledAt", new Date(Date.now() + 3600_000).toISOString());
    expect(first.status).toBe(201);

    const blocked = await request(app)
      .post("/api/social/posts")
      .set("Cookie", cookie)
      .field("channel", "INSTAGRAM")
      .field("scheduledAt", new Date(Date.now() + 3600_000).toISOString());
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("USAGE_LIMIT_REACHED");

    const count = await prisma.scheduledContent.count({ where: { tenantId: tenant.id, kind: "SOCIAL_POST" } });
    expect(count).toBe(1);
  });

  // --- CMS item caps (standing count, not a monthly counter) ---

  it("blocks creating a new CMS item once the plan's standing item cap is reached", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Business Website"); // CMS_CATEGORIES = 20
    await prisma.tenantFeatureOverride.create({ data: { tenantId: tenant.id, featureKey: "CMS_CATEGORIES", value: "1" } });
    await configureIntegration(tenant.id, "CATEGORIES", "https://example.com/api/categories", { permissionLevel: "MANAGE" });
    const cookie = await loginAs(admin.email);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "ext-1" }) } as Response);

    const first = await request(app).post("/api/website-content/CATEGORIES").set("Cookie", cookie).send({ name: "Silk" });
    expect(first.status).toBe(201);

    const blocked = await request(app).post("/api/website-content/CATEGORIES").set("Cookie", cookie).send({ name: "Cotton" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("USAGE_LIMIT_REACHED");
    expect(blocked.body.featureKey).toBe("CMS_CATEGORIES");

    const feature = await prisma.feature.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: "CATEGORIES" } } });
    const stored = await prisma.websiteContentItem.count({ where: { tenantId: tenant.id, featureId: feature.id } });
    expect(stored).toBe(1);

    fetchSpy.mockRestore();
  });

  it("does not cap FAQS, which has no CMS_ catalog entry", async () => {
    const { tenant, admin } = await createTenantWithAdmin(); // no plan at all
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    const cookie = await loginAs(admin.email);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "ext-1" }) } as Response);

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/api/website-content/FAQS").set("Cookie", cookie).send({ question: `Q${i}`, answer: "A" });
      expect(res.status).toBe(201);
    }

    fetchSpy.mockRestore();
  });

  // --- Data Connector (IMPORT_EXPORT — boolean gate, no CSV/API sub-tiers) ---

  it("blocks connector import/sync for a plan that doesn't include IMPORT_EXPORT", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Starter AI"); // IMPORT_EXPORT: not included on Starter
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    const cookie = await loginAs(admin.email);

    const importRes = await request(app).post("/api/website-content/FAQS/import").set("Cookie", cookie).send({});
    expect(importRes.status).toBe(403);
    expect(importRes.body.code).toBe("FEATURE_NOT_INCLUDED");

    const syncRes = await request(app).post("/api/website-content/FAQS/sync").set("Cookie", cookie);
    expect(syncRes.status).toBe(403);
    expect(syncRes.body.code).toBe("FEATURE_NOT_INCLUDED");
  });

  it("allows connector import once the plan includes IMPORT_EXPORT", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await assignPlan(tenant.id, "Business Website"); // IMPORT_EXPORT: CSV, included
    await configureIntegration(tenant.id, "FAQS", "https://example.com/api/faqs", { permissionLevel: "MANAGE" });
    const cookie = await loginAs(admin.email);
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: "ext-1", question: "Q", answer: "A" }] }) } as Response);

    const importRes = await request(app).post("/api/website-content/FAQS/import").set("Cookie", cookie).send({});
    expect(importRes.status).toBe(200);

    fetchSpy.mockRestore();
  });
});
