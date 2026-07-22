import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./helpers";

// The mock external site doubles as the reference implementation of the
// standardized admin GET/import contract (see routes/mockExternalSite.ts) —
// covers the { ok, data } envelope and that the standardized filters
// (slug/id/category/collection/featured/position/code) actually narrow the
// canned dataset, since real tenant sites are expected to behave the same way.
describe("mock external site: reference admin GET contract", () => {
  it("returns { ok: true, data: [...] } with no filters", async () => {
    const res = await request(app).get("/api/mock-external-site/products");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("filters by category", async () => {
    const res = await request(app).get("/api/mock-external-site/products").query({ category: "silk" });
    expect(res.body.data.every((item: { category: string }) => item.category === "silk")).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("filters by slug", async () => {
    const res = await request(app).get("/api/mock-external-site/categories").query({ slug: "banarasi" });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe("banarasi");
  });

  it("filters by featured=true", async () => {
    const res = await request(app).get("/api/mock-external-site/collections").query({ featured: "true" });
    expect(res.body.data.every((item: { featured: boolean }) => item.featured === true)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("filters by code", async () => {
    const res = await request(app).get("/api/mock-external-site/offers").query({ code: "FESTIVE20" });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe("FESTIVE20");
  });

  it("returns an empty list when no items match", async () => {
    const res = await request(app).get("/api/mock-external-site/products").query({ category: "no-such-category" });
    expect(res.body.data).toEqual([]);
  });

  it("paginates when both page and pageSize are provided, otherwise returns everything", async () => {
    const page1 = await request(app).get("/api/mock-external-site/products").query({ page: 1, pageSize: 2 });
    expect(page1.body.data).toHaveLength(2);

    const page2 = await request(app).get("/api/mock-external-site/products").query({ page: 2, pageSize: 2 });
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);

    const page3 = await request(app).get("/api/mock-external-site/products").query({ page: 3, pageSize: 2 });
    expect(page3.body.data).toEqual([]);

    // page/pageSize omitted — unpaginated, full-list behavior unchanged.
    const unpaginated = await request(app).get("/api/mock-external-site/products");
    expect(unpaginated.body.data.length).toBeGreaterThan(2);
  });

  it("wraps POST/PUT responses in the same { ok, data } envelope", async () => {
    const created = await request(app).post("/api/mock-external-site/categories").send({ name: "Test" });
    expect(created.status).toBe(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.data.name).toBe("Test");

    const updated = await request(app).put(`/api/mock-external-site/categories/${created.body.data.id}`).send({ name: "Updated" });
    expect(updated.body.ok).toBe(true);
    expect(updated.body.data.name).toBe("Updated");
  });
});
