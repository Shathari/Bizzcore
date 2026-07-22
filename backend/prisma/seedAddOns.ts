import type { PrismaClient } from "@prisma/client";

// Purchasable regardless of plan tier — see schema.prisma's AddOn model.
// "Custom Integration" from the source list is deliberately NOT here: its
// pricing ("Starts ₹10,000, quoted individually") isn't a fixed add-on
// price, it's a quote — it maps instead to CustomDevelopmentRequest's
// API_INTEGRATION service type (Third-party API Integration, ₹8,000–
// ₹30,000), built separately as its own request/quote flow.
//
// Two rows are flagged rather than silently modeled: "Additional Website"
// and "API Access" both set relatedFeatureKey to a TIER-valued
// FeatureCatalog entry (WEBSITE_INCLUDED, API_INTEGRATION), but the
// effective-limit calculation the spec describes ("plan value + sum of
// active topUpAmount") is explicitly scoped to NUMERIC features only.
// lib/entitlements.ts treats a TIER-related add-on as "grants inclusion"
// (flips effective `included` to true) rather than summing a quantity,
// since neither feature has a meaningful numeric total. Flagged for
// confirmation — see the chat summary.
export type AddOnDef = {
  name: string;
  description?: string;
  priceOneTime?: number;
  priceRecurring?: number;
  billingType: "OneTime" | "Recurring";
  relatedFeatureKey?: string;
  topUpAmount?: number;
};

export const ADDON_DEFS: AddOnDef[] = [
  { name: "Extra AI Generations (1,000)", priceRecurring: 499, billingType: "Recurring", relatedFeatureKey: "AI_CONTENT_GENERATION", topUpAmount: 1000 },
  { name: "AI Video Generation (100 videos)", priceRecurring: 999, billingType: "Recurring", relatedFeatureKey: "AI_VIDEO_GENERATION", topUpAmount: 100 },
  { name: "Additional WhatsApp (1,000 messages)", priceRecurring: 699, billingType: "Recurring", relatedFeatureKey: "WHATSAPP_MESSAGES", topUpAmount: 1000 },
  { name: "Additional SMS (1,000)", priceRecurring: 350, billingType: "Recurring", relatedFeatureKey: "SMS", topUpAmount: 1000 },
  { name: "Additional Emails (10,000)", priceRecurring: 299, billingType: "Recurring", relatedFeatureKey: "EMAILS", topUpAmount: 10000 },
  { name: "Extra Storage (10 GB)", priceRecurring: 199, billingType: "Recurring", relatedFeatureKey: "MEDIA_STORAGE", topUpAmount: 10 },
  { name: "Additional Team Member", priceRecurring: 299, billingType: "Recurring", relatedFeatureKey: "TEAM_MEMBERS", topUpAmount: 1 },
  // Flagged: WEBSITE_INCLUDED is TIER-valued (Basic/Dynamic/Premium), not
  // NUMERIC — topUpAmount 1 here doesn't sum into a meaningful total. See
  // module comment above.
  { name: "Additional Website", priceRecurring: 999, billingType: "Recurring", relatedFeatureKey: "WEBSITE_INCLUDED", topUpAmount: 1 },
  { name: "Custom Domain Setup", priceOneTime: 999, billingType: "OneTime" },
  { name: "Premium Template", priceOneTime: 2999, billingType: "OneTime" },
  // Flagged: API_INTEGRATION is TIER-valued; no topUpAmount given in the
  // source for this row (unlike the others) — modeled as inclusion-
  // granting rather than a quantity top-up. See module comment above.
  { name: "API Access", priceRecurring: 999, billingType: "Recurring", relatedFeatureKey: "API_INTEGRATION", description: "Only relevant if API Integration isn't already included in your plan." },
];

// Idempotent — upserts by name (same de-facto-stable-identifier approach
// as seedPlans.ts's Plan upsert, since AddOn has no other natural unique key).
export async function seedAddOnCatalog(prisma: PrismaClient): Promise<void> {
  for (const def of ADDON_DEFS) {
    const existing = await prisma.addOn.findFirst({ where: { name: def.name } });
    const data = {
      name: def.name,
      description: def.description ?? null,
      priceOneTime: def.priceOneTime ?? null,
      priceRecurring: def.priceRecurring ?? null,
      billingType: def.billingType,
      relatedFeatureKey: def.relatedFeatureKey ?? null,
      topUpAmount: def.topUpAmount ?? null,
      isActive: true,
    };
    if (existing) {
      await prisma.addOn.update({ where: { id: existing.id }, data });
    } else {
      await prisma.addOn.create({ data });
    }
  }
}
