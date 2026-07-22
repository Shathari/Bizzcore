-- Tenant-scoping migration for Feature, part 2 of 2. Drops the transient
-- handoff table now that prisma/scripts/tenant-scope-features.ts has
-- confirmed (verification pass, zero dangling references) that every
-- WebsiteIntegration/WebsiteContentItem/ConnectorAccessLog row has been
-- repointed to its tenant's own new Feature row.
DROP TABLE "Feature_legacy";
