import { requireFeatureIncluded } from "./entitlements";

// A "module" is a top-level product surface a tenant either has or doesn't
// (Home dashboard cards, nav sections), as opposed to a single feature's own
// quantity/tier limit. Modeled as a plain BOOLEAN FeatureCatalog entry per
// module (see prisma/seedPlans.ts's "--- Modules ---" section) rather than a
// new table — this reuses getEffectiveEntitlement's existing
// override -> plan layering unchanged, so a Super Admin can flip one
// tenant's module on/off via the existing TenantFeatureOverride mechanism
// without touching their plan, and everything module-gated (dashboard cards
// today, nav sections later) reads from the same single source of truth as
// every other entitlement in the app.
//
// WEBSITE deliberately reuses the pre-existing WEBSITE_INCLUDED tiered key
// (❌ = not included) instead of a redundant new boolean — that key was
// already functioning as the website module's own on/off switch before this
// file existed. WHATSAPP_REPEAT_SALES is the first module with a dedicated
// key of its own; SOCIAL_MEDIA/AI_CONTENT/ANALYTICS should follow its
// pattern (one BOOLEAN featureKey named after the module) when they're
// added here, not WEBSITE's.
export const MODULE_FEATURE_KEYS = {
  whatsappRepeatSales: "WHATSAPP_REPEAT_SALES",
  website: "WEBSITE_INCLUDED",
} as const;

export type ModuleKey = keyof typeof MODULE_FEATURE_KEYS;

export async function getActiveModules(tenantId: string): Promise<Record<ModuleKey, boolean>> {
  const entries = await Promise.all(
    (Object.entries(MODULE_FEATURE_KEYS) as Array<[ModuleKey, string]>).map(
      async ([moduleKey, featureKey]) => [moduleKey, await requireFeatureIncluded(tenantId, featureKey)] as const
    )
  );
  return Object.fromEntries(entries) as Record<ModuleKey, boolean>;
}
