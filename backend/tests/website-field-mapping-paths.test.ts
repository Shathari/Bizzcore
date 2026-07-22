import { describe, it, expect } from "vitest";
import { getByPath, setByPath, toExternalKeys, toDashboardKeys, walkSchema, type DiscoveredField } from "../src/lib/websiteApiClient";

// Unit coverage for the path-based field-mapping rewrite (see
// lib/websiteApiClient.ts) — the highest-risk part of adding nested-path
// support, since fieldMapping is a real column with real saved data on
// every existing integration and a flat mapping like {price: "price"} must
// keep behaving exactly as it did before nested paths existed.
describe("getByPath / setByPath", () => {
  it("resolves a flat key exactly like a plain property access", () => {
    expect(getByPath({ price: 100 }, "price")).toBe(100);
  });

  it("resolves a dotted nested path", () => {
    expect(getByPath({ category: { id: 1, name: "Silk" } }, "category.name")).toBe("Silk");
  });

  it("resolves a bracketed array index path", () => {
    expect(getByPath({ images: [{ url: "a.jpg" }, { url: "b.jpg" }] }, "images[0].url")).toBe("a.jpg");
    expect(getByPath({ images: [{ url: "a.jpg" }, { url: "b.jpg" }] }, "images[1].url")).toBe("b.jpg");
  });

  it("returns undefined for a path that doesn't exist, rather than throwing", () => {
    expect(getByPath({ a: 1 }, "b.c.d")).toBeUndefined();
    expect(getByPath({ images: [] }, "images[0].url")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });

  it("setByPath on a flat key is a direct assignment", () => {
    const target: Record<string, unknown> = {};
    setByPath(target, "price", 100);
    expect(target).toEqual({ price: 100 });
  });

  it("setByPath builds nested objects/arrays as needed", () => {
    const target: Record<string, unknown> = {};
    setByPath(target, "category.id", 5);
    setByPath(target, "images[0].url", "a.jpg");
    expect(target).toEqual({ category: { id: 5 }, images: [{ url: "a.jpg" }] });
  });
});

describe("toExternalKeys / toDashboardKeys — backward compatibility with flat mappings", () => {
  it("toExternalKeys: a flat mapping produces byte-identical output to a plain rename", () => {
    const payload = { price: 100, name: "x" };
    const mapping = { price: "selling_price" };
    expect(toExternalKeys(payload, mapping)).toEqual({ selling_price: 100, name: "x" });
  });

  it("toDashboardKeys: a flat mapping produces byte-identical output to a plain rename (source key not duplicated)", () => {
    const payload = { selling_price: 100, name: "x" };
    const mapping = { price: "selling_price" };
    const result = toDashboardKeys(payload, mapping);
    expect(result).toEqual({ price: 100, name: "x" });
    expect(result).not.toHaveProperty("selling_price");
  });

  it("unmapped fields still pass through under their own name on import, same as before nested paths existed", () => {
    const payload = { id: "1", name: "x", untouched: "y" };
    const mapping = { productName: "name" };
    expect(toDashboardKeys(payload, mapping)).toEqual({ id: "1", productName: "x", untouched: "y" });
  });

  it("null mapping is a no-op passthrough in both directions", () => {
    const payload = { a: 1 };
    expect(toExternalKeys(payload, null)).toBe(payload);
    expect(toDashboardKeys(payload, null)).toBe(payload);
  });
});

describe("toExternalKeys / toDashboardKeys — nested paths", () => {
  it("toExternalKeys builds a nested outbound payload from a flat dashboard payload", () => {
    const payload = { categoryId: 5, price: 100 };
    const mapping = { categoryId: "category.id" };
    expect(toExternalKeys(payload, mapping)).toEqual({ category: { id: 5 }, price: 100 });
  });

  it("toDashboardKeys promotes a nested leaf to a flat dashboard field without discarding the rest of the source object", () => {
    const payload = { category: { id: 1, name: "Silk" }, price: 100 };
    const mapping = { categoryName: "category.name" };
    const result = toDashboardKeys(payload, mapping);
    expect(result.categoryName).toBe("Silk");
    // The raw nested object is NOT suppressed — only an exact flat 1:1
    // rename of a top-level key (the pre-existing behavior) does that.
    expect(result.category).toEqual({ id: 1, name: "Silk" });
    expect(result.price).toBe(100);
  });

  it("toDashboardKeys resolves an array-index path", () => {
    const payload = { images: [{ url: "cover.jpg" }], name: "x" };
    const mapping = { image: "images[0].url" };
    expect(toDashboardKeys(payload, mapping)).toEqual({ image: "cover.jpg", images: [{ url: "cover.jpg" }], name: "x" });
  });

  it("round-trips: importing then re-exporting a nested-mapped field produces the same nested shape", () => {
    const external = { category: { id: 1, name: "Silk" }, price: 100 };
    const mapping = { categoryId: "category.id", price: "price" };
    const dashboard = toDashboardKeys(external, mapping);
    expect(dashboard.categoryId).toBe(1);
    const reExported = toExternalKeys({ categoryId: dashboard.categoryId, price: dashboard.price }, mapping);
    expect(reExported).toEqual({ category: { id: 1 }, price: 100 });
  });
});

describe("walkSchema — matches the spec's own worked example", () => {
  it("flattens a nested object + array-of-objects into dot/bracket leaf paths with inferred types", () => {
    const sample = {
      id: "abc",
      slug: "moonga-silk-saree",
      name: "Moonga Silk Saree",
      price: 499,
      category: { id: 1, name: "Silk" },
      images: [{ url: "https://example.com/a.jpg" }],
    };
    const fields = walkSchema(sample);
    const byPath = Object.fromEntries(fields.map((f: DiscoveredField) => [f.path, f.type]));
    expect(byPath).toEqual({
      id: "string",
      slug: "string",
      name: "string",
      price: "number",
      "category.id": "number",
      "category.name": "string",
      "images[0].url": "string",
    });
  });

  it("reports an empty array as a single array-typed leaf, not an error", () => {
    expect(walkSchema({ tags: [] })).toEqual([{ path: "tags", type: "array" }]);
  });

  it("reports an array of primitives as a single array-typed leaf, with no real value attached", () => {
    // No `sample` — DiscoveredField is name+type only, never a real value
    // from the tenant's site (see websiteApiClient.ts's DiscoveredField).
    expect(walkSchema({ tags: ["silk", "wedding"] })).toEqual([{ path: "tags", type: "array" }]);
  });

  it("detects boolean and date-like string types", () => {
    const fields = walkSchema({ inStock: true, publishedAt: "2026-07-17T00:00:00Z" });
    const byPath = Object.fromEntries(fields.map((f: DiscoveredField) => [f.path, f.type]));
    expect(byPath).toEqual({ inStock: "boolean", publishedAt: "date" });
  });

  it("does not misclassify an ordinary numeric-looking string as a date", () => {
    const fields = walkSchema({ sku: "2024" });
    expect(fields[0].type).toBe("string");
  });
});
