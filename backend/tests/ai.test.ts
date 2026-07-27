import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Mocks the `openai` package's default export so no real network call is
// ever made — the test controls exactly what the "model" returns. Must be
// a real class/function (not an arrow function) since ai.ts calls
// `new OpenAI(...)`, and arrow functions can never be used as constructors.
// /generate and /refine ask for different response shapes (plain text vs.
// a json_object), so the mock branches on the request's response_format
// to return the right one instead of needing two separate mocks.
vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(async (params: { response_format?: { type: string } }) => {
          if (params.response_format?.type === "json_object") {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      suggestions: ["Festival-led brief — mock suggestion one.", "Craft-led brief — mock suggestion two."],
                    }),
                  },
                },
              ],
            };
          }
          return { choices: [{ message: { content: "Drape into the season — mock generated copy. #Test" } }] };
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

describe("AI Marketing Assistant", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("reports not configured when OPENAI_API_KEY is unset", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const statusRes = await request(app).get("/api/ai/status").set("Cookie", cookie);
    expect(statusRes.body).toEqual({ configured: false });

    const genRes = await request(app)
      .post("/api/ai/generate")
      .set("Cookie", cookie)
      .send({ contentType: "Instagram Caption", tone: "Elegant" });
    expect(genRes.status).toBe(503);
    expect(genRes.body.error).toMatch(/not configured/i);
  });

  it("does not persist a generation when unconfigured", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Instagram Caption", tone: "Elegant" });

    const count = await prisma.aIGeneration.count({ where: { tenantId: tenant.id } });
    expect(count).toBe(0);
  });

  it("generates and persists content when configured (mocked OpenAI)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    const statusRes = await request(app).get("/api/ai/status").set("Cookie", cookie);
    expect(statusRes.body).toEqual({ configured: true });

    const res = await request(app)
      .post("/api/ai/generate")
      .set("Cookie", cookie)
      .send({ contentType: "Instagram Caption", tone: "Elegant", productName: "Kanjivaram Silk" });

    expect(res.status).toBe(201);
    expect(res.body.output).toContain("mock generated copy");
    expect(res.body.tenantId).toBe(tenant.id);

    const stored = await prisma.aIGeneration.findUnique({ where: { id: res.body.id } });
    expect(stored?.output).toContain("mock generated copy");
  });

  it("rejects an invalid content type with 400", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app)
      .post("/api/ai/generate")
      .set("Cookie", cookie)
      .send({ contentType: "Not A Real Type", tone: "Elegant" });
    expect(res.status).toBe(400);
  });

  it("lists generations scoped to the tenant, most recent first", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { tenant, admin } = await createTenantWithAdmin();
    await grantPermissivePlan(tenant.id);
    const cookie = await loginAs(admin.email);

    await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "Hashtags", tone: "Bold" });
    await request(app).post("/api/ai/generate").set("Cookie", cookie).send({ contentType: "SEO Title", tone: "Minimal" });

    const res = await request(app).get("/api/ai/generations").set("Cookie", cookie);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].contentType).toBe("SEO Title");
  });

  describe("POST /refine", () => {
    it("reports not configured when OPENAI_API_KEY is unset", async () => {
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);

      const res = await request(app)
        .post("/api/ai/refine")
        .set("Cookie", cookie)
        .send({ contentType: "Instagram Caption", tone: "Elegant", rawIdea: "diwali sale saree new collection" });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/i);
    });

    it("rejects an empty rough idea with 400", async () => {
      process.env.OPENAI_API_KEY = "sk-test-fake-key";
      const { admin } = await createTenantWithAdmin();
      const cookie = await loginAs(admin.email);

      const res = await request(app)
        .post("/api/ai/refine")
        .set("Cookie", cookie)
        .send({ contentType: "Instagram Caption", tone: "Elegant", rawIdea: "" });
      expect(res.status).toBe(400);
    });

    it("returns 2-3 editable suggestions without spending a usage unit", async () => {
      process.env.OPENAI_API_KEY = "sk-test-fake-key";
      const { tenant, admin } = await createTenantWithAdmin();
      await grantPermissivePlan(tenant.id);
      const cookie = await loginAs(admin.email);

      const res = await request(app)
        .post("/api/ai/refine")
        .set("Cookie", cookie)
        .send({ contentType: "Instagram Caption", tone: "Elegant", rawIdea: "diwali sale saree new collection" });

      expect(res.status).toBe(200);
      expect(res.body.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(res.body.suggestions.length).toBeLessThanOrEqual(3);
      expect(res.body.suggestions[0]).toMatch(/brief/i);

      // Refining is not itself a generation — no AIGeneration row, and the
      // monthly usage counter for AI_CONTENT_GENERATION stays untouched.
      const genCount = await prisma.aIGeneration.count({ where: { tenantId: tenant.id } });
      expect(genCount).toBe(0);
      const usageRes = await request(app).get("/api/ai/usage").set("Cookie", cookie);
      expect(usageRes.body.used).toBe(0);
    });

    it("blocks refine when the plan doesn't include AI Content Generation", async () => {
      process.env.OPENAI_API_KEY = "sk-test-fake-key";
      const { admin } = await createTenantWithAdmin();
      // No grantPermissivePlan — tenant has no plan, so the feature isn't included.
      const cookie = await loginAs(admin.email);

      const res = await request(app)
        .post("/api/ai/refine")
        .set("Cookie", cookie)
        .send({ contentType: "Instagram Caption", tone: "Elegant", rawIdea: "diwali sale saree new collection" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FEATURE_NOT_INCLUDED");
    });
  });
});
