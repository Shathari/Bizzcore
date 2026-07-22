import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, grantPermissivePlan } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Mocks the `openai` package's default export so no real network call is
// ever made — the test controls exactly what the "model" returns. Must be
// a real class/function (not an arrow function) since ai.ts calls
// `new OpenAI(...)`, and arrow functions can never be used as constructors.
vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "Drape into the season — mock generated copy. #Test" } }],
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
});
