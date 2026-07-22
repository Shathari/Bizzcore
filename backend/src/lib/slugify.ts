import type { FieldDef } from "./featureCatalog";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// External website APIs commonly require an explicit `slug` field
// (see websiteContentService.ts) — derive one from whichever title-like
// field the payload has if the caller didn't already supply one. Gated on
// the feature's OWN field list actually declaring a "slug" field — every
// built-in that has one (Products/Collections/Categories/Offers/Blogs) also
// has a "name" or "title" field, so this is a no-op change for all of
// them; the gate only matters for a custom feature with a "name"/"title"
// field but no "slug" field, where this used to silently inject a "slug"
// key the feature's own schema never declared (and the tenant's external
// API was never told to expect).
export function ensureSlug(payload: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  if (!fields.some((f) => f.key === "slug")) return payload;
  if (typeof payload.slug === "string" && payload.slug.trim()) {
    return { ...payload, slug: slugify(payload.slug) };
  }
  const source = payload.name ?? payload.title;
  if (typeof source === "string" && source.trim()) {
    return { ...payload, slug: slugify(source) };
  }
  return payload;
}
