import type { PrismaClient } from "@prisma/client";

// Subscription plan catalog — FeatureCatalog + the 4 real plans with their
// full PlanFeature grid. This is platform-wide config, not per-tenant demo
// data, so it lives in its own module and is seeded unconditionally
// (upserted, idempotent) rather than only for the two demo tenants — same
// separation as builtInFeatures.ts (Feature catalog) vs. seed.ts (demo
// tenants/customers).

export type ValueType = "NUMERIC" | "BOOLEAN" | "TIER" | "TEXT";

// One row per source-table line. `cells` are the 4 plan columns in fixed
// order [Starter, Website, Growth, Enterprise], written as the exact
// display text EXCEPT: a bare ✅ within a TIER row (a row that also has
// real tier text in another cell, e.g. SEO Optimized's Enterprise
// "Advanced") is pre-resolved to the literal string "Included" here rather
// than left as "✅" — see PLAN_STRUCTURE_NOTES below for why.
type FeatureRow = {
  featureKey: string;
  category: string;
  displayName: string;
  valueType: ValueType;
  unit: string | null;
  cells: [string, string, string, string];
};

const FEATURE_ROWS: FeatureRow[] = [
  // --- AI & Marketing ---------------------------------------------------
  { featureKey: "AI_CONTENT_GENERATION", category: "AI_MARKETING", displayName: "AI Content Generation", valueType: "NUMERIC", unit: "/mo", cells: ["100", "500", "2000", "unlimited"] },
  { featureKey: "AI_CAPTIONS", category: "AI_MARKETING", displayName: "AI Captions", valueType: "NUMERIC", unit: "/mo", cells: ["100", "500", "2000", "unlimited"] },
  { featureKey: "TRENDING_HASHTAGS", category: "AI_MARKETING", displayName: "Trending Hashtags", valueType: "NUMERIC", unit: "/mo", cells: ["100", "500", "2000", "unlimited"] },
  { featureKey: "SEO_CONTENT", category: "AI_MARKETING", displayName: "SEO Content", valueType: "NUMERIC", unit: "/mo", cells: ["20", "100", "500", "unlimited"] },
  { featureKey: "PRODUCT_DESCRIPTION_GENERATOR", category: "AI_MARKETING", displayName: "Product Description Generator", valueType: "NUMERIC", unit: "/mo", cells: ["50", "300", "1000", "unlimited"] },
  { featureKey: "BLOG_GENERATION", category: "AI_MARKETING", displayName: "Blog Generation", valueType: "NUMERIC", unit: "/mo", cells: ["❌", "20", "100", "unlimited"] },
  { featureKey: "AI_IMAGE_GENERATION", category: "AI_MARKETING", displayName: "AI Image Generation", valueType: "NUMERIC", unit: "/mo", cells: ["10", "50", "200", "1000"] },
  { featureKey: "AI_VIDEO_GENERATION", category: "AI_MARKETING", displayName: "AI Video Generation", valueType: "NUMERIC", unit: "/mo", cells: ["Add-on", "10", "50", "200"] },

  // --- Social Media Manager ----------------------------------------------
  { featureKey: "CONNECTED_ACCOUNTS", category: "SOCIAL_MEDIA", displayName: "Connected Accounts", valueType: "NUMERIC", unit: "accounts", cells: ["2", "5", "15", "unlimited"] },
  { featureKey: "SCHEDULED_POSTS", category: "SOCIAL_MEDIA", displayName: "Scheduled Posts", valueType: "NUMERIC", unit: "/mo", cells: ["100", "500", "unlimited", "unlimited"] },
  { featureKey: "CONTENT_CALENDAR", category: "SOCIAL_MEDIA", displayName: "Content Calendar", valueType: "BOOLEAN", unit: null, cells: ["✅", "✅", "✅", "✅"] },
  { featureKey: "DRAFT_MANAGEMENT", category: "SOCIAL_MEDIA", displayName: "Draft Management", valueType: "BOOLEAN", unit: null, cells: ["✅", "✅", "✅", "✅"] },
  { featureKey: "SOCIAL_INBOX", category: "SOCIAL_MEDIA", displayName: "Social Inbox", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Premium"] },
  { featureKey: "AI_REPLY_SUGGESTIONS", category: "SOCIAL_MEDIA", displayName: "AI Reply Suggestions", valueType: "BOOLEAN", unit: null, cells: ["❌", "✅", "✅", "✅"] },
  { featureKey: "SOCIAL_ANALYTICS", category: "SOCIAL_MEDIA", displayName: "Social Analytics", valueType: "TIER", unit: null, cells: ["Basic", "Standard", "Advanced", "Enterprise"] },

  // --- Communication Center -----------------------------------------------
  { featureKey: "WHATSAPP_MESSAGES", category: "COMMUNICATION", displayName: "WhatsApp Messages", valueType: "NUMERIC", unit: "/mo", cells: ["200", "1000", "5000", "20000"] },
  { featureKey: "EMAILS", category: "COMMUNICATION", displayName: "Emails", valueType: "NUMERIC", unit: "/mo", cells: ["500", "5000", "20000", "100000"] },
  { featureKey: "SMS", category: "COMMUNICATION", displayName: "SMS", valueType: "NUMERIC", unit: "/mo", cells: ["100", "500", "2000", "10000"] },
  { featureKey: "PUSH_NOTIFICATIONS", category: "COMMUNICATION", displayName: "Push Notifications", valueType: "NUMERIC", unit: "/mo", cells: ["❌", "2000", "20000", "unlimited"] },

  // --- Website ------------------------------------------------------------
  { featureKey: "WEBSITE_INCLUDED", category: "WEBSITE", displayName: "Website Included", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Dynamic", "Premium"] },
  { featureKey: "CUSTOM_DOMAIN", category: "WEBSITE", displayName: "Custom Domain", valueType: "BOOLEAN", unit: null, cells: ["❌", "✅", "✅", "✅"] },
  { featureKey: "SSL", category: "WEBSITE", displayName: "SSL", valueType: "BOOLEAN", unit: null, cells: ["❌", "✅", "✅", "✅"] },
  { featureKey: "MOBILE_RESPONSIVE", category: "WEBSITE", displayName: "Mobile Responsive", valueType: "BOOLEAN", unit: null, cells: ["❌", "✅", "✅", "✅"] },
  { featureKey: "SEO_OPTIMIZED", category: "WEBSITE", displayName: "SEO Optimized", valueType: "TIER", unit: null, cells: ["❌", "Included", "Included", "Advanced"] },
  { featureKey: "PREMIUM_TEMPLATES", category: "WEBSITE", displayName: "Premium Templates", valueType: "TIER", unit: null, cells: ["❌", "Limited", "More", "All"] },
  { featureKey: "BLOG_MODULE", category: "WEBSITE", displayName: "Blog Module", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Advanced"] },
  { featureKey: "CONTACT_FORMS", category: "WEBSITE", displayName: "Contact Forms", valueType: "TIER", unit: null, cells: ["❌", "Included", "Included", "Advanced"] },
  { featureKey: "LEAD_CAPTURE", category: "WEBSITE", displayName: "Lead Capture", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },

  // --- Website CMS ----------------------------------------------------------
  { featureKey: "CMS_DASHBOARD_ACCESS", category: "WEBSITE_CMS", displayName: "Dashboard Access", valueType: "TIER", unit: null, cells: ["❌", "Limited", "Full", "Full"] },
  { featureKey: "CMS_PRODUCTS", category: "WEBSITE_CMS", displayName: "Products", valueType: "NUMERIC", unit: "items", cells: ["❌", "100", "unlimited", "unlimited"] },
  { featureKey: "CMS_CATEGORIES", category: "WEBSITE_CMS", displayName: "Categories", valueType: "NUMERIC", unit: "items", cells: ["❌", "20", "unlimited", "unlimited"] },
  { featureKey: "CMS_COLLECTIONS", category: "WEBSITE_CMS", displayName: "Collections", valueType: "NUMERIC", unit: "items", cells: ["❌", "20", "unlimited", "unlimited"] },
  { featureKey: "CMS_OFFERS", category: "WEBSITE_CMS", displayName: "Offers", valueType: "NUMERIC", unit: "items", cells: ["❌", "20", "unlimited", "unlimited"] },
  { featureKey: "CMS_BANNERS", category: "WEBSITE_CMS", displayName: "Banners", valueType: "NUMERIC", unit: "items", cells: ["❌", "10", "unlimited", "unlimited"] },
  { featureKey: "CMS_BLOGS", category: "WEBSITE_CMS", displayName: "Blogs", valueType: "NUMERIC", unit: "items", cells: ["❌", "25", "unlimited", "unlimited"] },
  { featureKey: "MEDIA_STORAGE", category: "WEBSITE_CMS", displayName: "Media Storage", valueType: "NUMERIC", unit: "GB", cells: ["❌", "2", "20", "100"] },

  // --- Business Dashboard -----------------------------------------------
  { featureKey: "BUSINESS_DASHBOARD", category: "BUSINESS_DASHBOARD", displayName: "Dashboard", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "LEAD_MANAGER", category: "BUSINESS_DASHBOARD", displayName: "Lead Manager", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "CUSTOMER_MANAGER", category: "BUSINESS_DASHBOARD", displayName: "Customer Manager", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Unlimited", "Unlimited"] },
  { featureKey: "WEBSITE_SYNC", category: "BUSINESS_DASHBOARD", displayName: "Website Sync", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "IMPORT_EXPORT", category: "BUSINESS_DASHBOARD", displayName: "Import / Export", valueType: "TIER", unit: null, cells: ["❌", "CSV", "CSV+Excel", "API+Bulk"] },
  { featureKey: "DYNAMIC_FIELD_MAPPING", category: "BUSINESS_DASHBOARD", displayName: "Dynamic Field Mapping", valueType: "BOOLEAN", unit: null, cells: ["❌", "❌", "✅", "✅"] },
  { featureKey: "API_INTEGRATION", category: "BUSINESS_DASHBOARD", displayName: "API Integration", valueType: "TIER", unit: null, cells: ["❌", "Limited", "Advanced", "Unlimited"] },

  // --- Analytics ------------------------------------------------------------
  { featureKey: "WEBSITE_ANALYTICS", category: "ANALYTICS", displayName: "Website Analytics", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "MARKETING_ANALYTICS", category: "ANALYTICS", displayName: "Marketing Analytics", valueType: "TIER", unit: null, cells: ["Basic", "Standard", "Advanced", "Enterprise"] },
  { featureKey: "CUSTOMER_INSIGHTS", category: "ANALYTICS", displayName: "Customer Insights", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "AI Powered"] },
  { featureKey: "SEO_REPORTS", category: "ANALYTICS", displayName: "SEO Reports", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "CONVERSION_TRACKING", category: "ANALYTICS", displayName: "Conversion Tracking", valueType: "BOOLEAN", unit: null, cells: ["❌", "❌", "✅", "✅"] },

  // --- Team & Access --------------------------------------------------------
  { featureKey: "TEAM_MEMBERS", category: "TEAM_ACCESS", displayName: "Team Members", valueType: "NUMERIC", unit: "members", cells: ["1", "3", "10", "unlimited"] },
  { featureKey: "ROLES_PERMISSIONS", category: "TEAM_ACCESS", displayName: "Roles & Permissions", valueType: "TIER", unit: null, cells: ["❌", "Basic", "Advanced", "Enterprise"] },
  { featureKey: "ACTIVITY_LOGS", category: "TEAM_ACCESS", displayName: "Activity Logs", valueType: "BOOLEAN", unit: null, cells: ["❌", "❌", "✅", "✅"] },
  { featureKey: "AUDIT_LOGS", category: "TEAM_ACCESS", displayName: "Audit Logs", valueType: "BOOLEAN", unit: null, cells: ["❌", "❌", "✅", "✅"] },

  // --- Support --------------------------------------------------------------
  { featureKey: "EMAIL_SUPPORT", category: "SUPPORT", displayName: "Email Support", valueType: "TIER", unit: null, cells: ["Included", "Included", "Priority", "Priority"] },
  { featureKey: "WHATSAPP_SUPPORT", category: "SUPPORT", displayName: "WhatsApp Support", valueType: "TIER", unit: null, cells: ["❌", "Business Hours", "Priority", "Dedicated"] },
  { featureKey: "ONBOARDING", category: "SUPPORT", displayName: "Onboarding", valueType: "TIER", unit: null, cells: ["Self", "Guided", "Premium", "White Glove"] },
  { featureKey: "DEDICATED_SUCCESS_MANAGER", category: "SUPPORT", displayName: "Dedicated Success Manager", valueType: "BOOLEAN", unit: null, cells: ["❌", "❌", "❌", "✅"] },
  { featureKey: "MONTHLY_STRATEGY_CALL", category: "SUPPORT", displayName: "Monthly Strategy Call", valueType: "TIER", unit: null, cells: ["❌", "❌", "Quarterly", "Monthly"] },
];

export const PLAN_DEFS = [
  { name: "Starter AI", priceMonthly: 999, priceYearly: 9999, isFeatured: false },
  { name: "Business Website", priceMonthly: 2499, priceYearly: 24999, isFeatured: true },
  { name: "Business Growth", priceMonthly: 5999, priceYearly: 59999, isFeatured: false },
  { name: "Enterprise / Business OS", priceMonthly: 14999, priceYearly: 149999, isFeatured: false },
] as const;

// Parses one source-table cell into { included, value }. "Add-on" means the
// feature is NOT part of this plan's own allocation (only purchasable
// separately — see AddOn.relatedFeatureKey), so it's included: false here,
// same as ❌ — the add-on catalog is what actually carries the "10/mo"
// figure for that case.
function parseCell(cell: string): { included: boolean; value: string | null } {
  const trimmed = cell.trim();
  if (trimmed === "❌" || trimmed === "Add-on") return { included: false, value: null };
  if (trimmed === "✅") return { included: true, value: null };
  if (/^unlimited\*?$/i.test(trimmed)) return { included: true, value: "unlimited" };
  const numeric = trimmed.replace(/,/g, "");
  if (/^\d+$/.test(numeric)) return { included: true, value: numeric };
  return { included: true, value: trimmed };
}

// Idempotent — safe to re-run. Upserts FeatureCatalog by featureKey (real
// unique key) and Plan by name (no natural unique key in the schema, so
// name is treated as the de-facto stable identifier for this fixed,
// hand-authored catalog of exactly 4 plans).
export async function seedSubscriptionPlans(prisma: PrismaClient): Promise<void> {
  for (const [index, row] of FEATURE_ROWS.entries()) {
    await prisma.featureCatalog.upsert({
      where: { featureKey: row.featureKey },
      update: { category: row.category, displayName: row.displayName, valueType: row.valueType, unit: row.unit, sortOrder: index },
      create: { featureKey: row.featureKey, category: row.category, displayName: row.displayName, valueType: row.valueType, unit: row.unit, sortOrder: index },
    });
  }

  for (const [planIndex, planDef] of PLAN_DEFS.entries()) {
    const existing = await prisma.plan.findFirst({ where: { name: planDef.name } });
    const plan = existing
      ? await prisma.plan.update({
          where: { id: existing.id },
          data: { priceMonthly: planDef.priceMonthly, priceYearly: planDef.priceYearly, isFeatured: planDef.isFeatured, isActive: true },
        })
      : await prisma.plan.create({
          data: { name: planDef.name, priceMonthly: planDef.priceMonthly, priceYearly: planDef.priceYearly, isFeatured: planDef.isFeatured, isActive: true },
        });

    for (const row of FEATURE_ROWS) {
      const { included, value } = parseCell(row.cells[planIndex]);
      await prisma.planFeature.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey: row.featureKey } },
        update: { included, value },
        create: { planId: plan.id, featureKey: row.featureKey, included, value },
      });
    }
  }
}

// Assumptions/interpretation choices made translating the source table into
// this schema — surfaced here (and in the chat summary) rather than
// silently baked in:
//   1. "Unlimited*" (the fair-use-policy asterisk) is stored as plain
//      "unlimited" — true unlimited, no hidden cap, per explicit instruction.
//   2. "Add-on" cells (AI Video Generation, Starter) are included: false —
//      not part of the plan's own allocation, only available via the
//      add-on catalog.
//   3. Rows that mix ✅ with real tier text in another cell (SEO Optimized,
//      Contact Forms, Email Support) are modeled as TIER, with the ✅ cells
//      normalized to the literal value "Included" rather than left as "✅"
//      or null, so every cell in a TIER row is comparable display text.
export const PLAN_STRUCTURE_NOTES = [
  "unlimited* fair-use asterisk implemented as true unlimited (no hidden cap) — flagged for a later product decision",
  "\"Add-on\"-only cells (AI Video Generation on Starter) treated as not included in the plan itself",
  "Mixed ✅/tier-text rows (SEO Optimized, Contact Forms, Email Support) normalized to TIER with ✅ → \"Included\"",
];
