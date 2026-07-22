import type { RequestHandler } from "express";
import { checkAndIncrementUsage, requireFeatureIncluded, checkItemCountCap } from "../lib/entitlements";
import { prisma } from "../lib/prisma";
import { getFeatureByKey } from "../lib/featureCatalog";

// Monthly-consumption gate (AI_CONTENT_GENERATION, WHATSAPP_MESSAGES,
// SCHEDULED_POSTS) — checks AND spends a unit in one step. Only use this
// where the route has no meaningful "the check passed but the actual
// action still failed" gap; ai.ts's OpenAI call does have that gap, so it
// calls checkUsageLimit/incrementUsage directly instead of this
// middleware. Must run after resolveTenant.
export function enforceUsageLimit(featureKey: string): RequestHandler {
  return async (req, res, next) => {
    const result = await checkAndIncrementUsage(req.tenantId!, featureKey);
    if (!result.allowed) {
      res.status(403).json({
        error:
          result.reason === "not_included"
            ? "Your current plan doesn't include this feature. Upgrade your plan to use it."
            : `You've reached your plan's monthly limit for this feature (${result.used}/${result.limit}). Upgrade your plan, or wait for next month's reset.`,
        code: result.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
        featureKey,
      });
      return;
    }
    next();
  };
}

// Plain inclusion gate for BOOLEAN/TIER features (e.g. IMPORT_EXPORT) —
// no quantity, just "is this in the plan at all". Must run after
// resolveTenant.
export function enforceFeatureIncluded(featureKey: string): RequestHandler {
  return async (req, res, next) => {
    const included = await requireFeatureIncluded(req.tenantId!, featureKey);
    if (!included) {
      res.status(403).json({
        error: "Your current plan doesn't include this feature. Upgrade your plan to use it.",
        code: "FEATURE_NOT_INCLUDED",
        featureKey,
      });
      return;
    }
    next();
  };
}

// Built-in website-content types with a matching CMS_ catalog entry — only
// these 6 have a real NUMERIC standing-item-cap row in FeatureCatalog.
// TESTIMONIALS/FAQS/CONTACT_DETAILS and any Super-Admin-created custom
// feature have no catalog entry at all, so they're intentionally absent
// here and stay unenforced (no number to enforce against).
const CMS_ITEM_CAP_FEATURE_KEYS: Record<string, string> = {
  PRODUCTS: "CMS_PRODUCTS",
  CATEGORIES: "CMS_CATEGORIES",
  COLLECTIONS: "CMS_COLLECTIONS",
  OFFERS: "CMS_OFFERS",
  BANNERS: "CMS_BANNERS",
  BLOGS: "CMS_BLOGS",
};

// Gates creating a new website-content item against the plan's standing
// item cap for that content type (e.g. "100 products"). A live COUNT of
// existing rows, not a UsageCounter — these are inventory caps, not
// monthly consumption (unit is "items", not "/mo"). Must run after
// resolveTenant. Requires a `:contentType` (Feature key) route param —
// same param requireContentWriteAccess reads.
export const enforceCmsItemCap: RequestHandler = async (req, res, next) => {
  const contentType = req.params.contentType;
  const featureKey = CMS_ITEM_CAP_FEATURE_KEYS[contentType];
  if (!featureKey) {
    next();
    return;
  }

  const feature = await getFeatureByKey(req.tenantId!, contentType);
  if (!feature) {
    next(); // unknown content type — let the route's own lookup 400/404 it
    return;
  }

  const currentCount = await prisma.websiteContentItem.count({
    where: { tenantId: req.tenantId!, featureId: feature.id }, // tenant-scoped
  });

  const check = await checkItemCountCap(req.tenantId!, featureKey, currentCount);
  if (!check.allowed) {
    res.status(403).json({
      error:
        check.reason === "not_included"
          ? `Your current plan doesn't include ${feature.label}. Upgrade your plan to use it.`
          : `You've reached your plan's limit of ${check.limit} ${feature.label.toLowerCase()} (currently ${check.used}). Upgrade your plan to add more.`,
      code: check.reason === "not_included" ? "FEATURE_NOT_INCLUDED" : "USAGE_LIMIT_REACHED",
      featureKey,
    });
    return;
  }
  next();
};
