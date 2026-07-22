import type { PrismaClient } from "@prisma/client";
import type { FieldDef } from "../src/lib/featureCatalog";

export type BuiltInFeature = {
  key: string;
  label: string;
  singularLabel?: string;
  isSingleton: boolean;
  fields: FieldDef[];
};

const STOCK_STATUSES = ["Available", "Sold", "Reserved"];

// The original 9 hardcoded content types, now seeded as Feature catalog
// rows instead of living in TypeScript unions. This is the ONLY place
// their definitions live going forward — Super Admin can edit any of
// these (including built-ins) via the Feature Catalog UI after seeding.
export const BUILT_IN_FEATURES: BuiltInFeature[] = [
  {
    key: "PRODUCTS",
    label: "Products",
    isSingleton: false,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text" },
      { key: "sku", label: "SKU", type: "text", required: true },
      { key: "price", label: "Price (₹)", type: "number", required: true },
      { key: "fabric", label: "Fabric", type: "text" },
      { key: "color", label: "Color", type: "text" },
      { key: "stockStatus", label: "Stock status", type: "select", options: STOCK_STATUSES },
      { key: "collectionName", label: "Collection", type: "text" },
      { key: "image", label: "Image", type: "image" },
    ],
  },
  {
    key: "COLLECTIONS",
    label: "Collections",
    isSingleton: false,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "BANNERS",
    label: "Banners",
    isSingleton: false,
    fields: [
      { key: "image", label: "Banner image", type: "image", required: true },
      { key: "active", label: "Active", type: "checkbox" },
    ],
  },
  {
    key: "OFFERS",
    label: "Offers",
    isSingleton: false,
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text" },
      { key: "discountPercent", label: "Discount %", type: "number", required: true },
      { key: "validFrom", label: "Valid from", type: "date", required: true },
      { key: "validTo", label: "Valid to", type: "date", required: true },
      { key: "active", label: "Active", type: "checkbox" },
    ],
  },
  {
    key: "CATEGORIES",
    label: "Categories",
    singularLabel: "Category",
    isSingleton: false,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "TESTIMONIALS",
    label: "Testimonials",
    isSingleton: false,
    fields: [
      { key: "customerName", label: "Customer name", type: "text", required: true },
      { key: "quote", label: "Quote", type: "textarea", required: true },
      { key: "rating", label: "Rating (1-5)", type: "number" },
    ],
  },
  {
    key: "BLOGS",
    label: "Blogs",
    isSingleton: false,
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text" },
      { key: "excerpt", label: "Excerpt", type: "textarea" },
      { key: "content", label: "Content", type: "textarea", required: true },
    ],
  },
  {
    key: "FAQS",
    label: "FAQs",
    isSingleton: false,
    fields: [
      { key: "question", label: "Question", type: "text", required: true },
      { key: "answer", label: "Answer", type: "textarea", required: true },
    ],
  },
  {
    key: "CONTACT_DETAILS",
    label: "Contact Details",
    isSingleton: true,
    fields: [
      { key: "address", label: "Address", type: "textarea" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "mapUrl", label: "Map URL", type: "text" },
    ],
  },
];

// Idempotent — safe to call on every test run and every dev seed. Used by
// tests/globalSetup.ts (fresh test.db, catalog only) and prisma/seed.ts
// (dev.db, catalog + demo tenant data) so both start from the exact same
// built-in definitions.
//
// Seeds FeatureTemplate, NOT Feature — Feature is tenant-scoped (each
// tenant gets its own independent row, cloned from this template on first
// access; see lib/featureCatalog.ts's ensureBuiltIns). This template
// catalog is the one genuinely-global, FK-less source of truth for what a
// brand-new tenant's built-ins start out looking like.
export async function seedBuiltInFeatures(prisma: PrismaClient): Promise<void> {
  for (const feature of BUILT_IN_FEATURES) {
    await prisma.featureTemplate.upsert({
      where: { key: feature.key },
      update: {
        label: feature.label,
        singularLabel: feature.singularLabel ?? null,
        isSingleton: feature.isSingleton,
        fields: JSON.stringify(feature.fields),
      },
      create: {
        key: feature.key,
        label: feature.label,
        singularLabel: feature.singularLabel ?? null,
        isSingleton: feature.isSingleton,
        fields: JSON.stringify(feature.fields),
      },
    });
  }
}
