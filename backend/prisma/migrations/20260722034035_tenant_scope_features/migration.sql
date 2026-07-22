-- Tenant-scoping migration for Feature, part 1 of 2.
--
-- Feature moves from a single globally-shared row per `key` to one
-- independent row per (tenantId, key). Splitting one existing global row
-- into N per-tenant clones (reconciled against each tenant's actual
-- WebsiteContentItem.payload, so nobody silently loses a field their real
-- data still uses) requires JS/JSON logic that plain SQL can't express, so
-- this migration only does the safe, mechanical part:
--   1. Create FeatureTemplate (the new genuinely-global, FK-less catalog).
--   2. Rename the current "Feature" table to "Feature_legacy", untouched,
--      so prisma/scripts/tenant-scope-features.ts can read the original
--      9 rows out of it.
--   3. Create the new, empty, tenant-scoped "Feature" table.
--   4. Rebuild WebsiteIntegration/WebsiteContentItem/ConnectorAccessLog
--      with IDENTICAL columns/data, changing only their featureId foreign
--      key to target the new "Feature" table instead of "Feature_legacy".
--      This step is required: SQLite's ALTER TABLE RENAME automatically
--      rewrites other tables' existing FK clauses to keep pointing at the
--      renamed table (confirmed live via `PRAGMA foreign_key_list` after
--      a first attempt at this migration without it) -- without rebuilding
--      these three, their FKs would silently keep targeting
--      "Feature_legacy" forever, and the data script's UPDATE of featureId
--      to a new (per-tenant) Feature id would fail with a foreign key
--      violation, which is exactly what happened on the first attempt.
--      Existing featureId values (still the old, now-orphaned ids) are
--      preserved as-is by this rebuild -- foreign_keys is OFF for the
--      duration, so the temporarily-dangling references don't block the
--      rebuild; the data script repoints every one of them immediately
--      after, before anything else runs.
--
-- prisma/scripts/tenant-scope-features.ts (run immediately after this
-- migration is applied, before anything else touches the app) then
-- populates the new "Feature" table with one row per tenant that actually
-- referenced each old global feature, and repoints every
-- WebsiteIntegration/WebsiteContentItem/ConnectorAccessLog.featureId from
-- the old id to that tenant's new one. A second migration
-- (20260722034036_drop_feature_legacy) then drops "Feature_legacy" once
-- the script confirms nothing references it anymore.

-- CreateTable
CREATE TABLE "FeatureTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "singularLabel" TEXT,
    "isSingleton" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "FeatureTemplate_key_key" ON "FeatureTemplate"("key");

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Preserve the original global rows, untouched, under a new name for the
-- data script to read from. Not a Prisma-tracked model -- purely a
-- transient handoff table, dropped by the next migration.
ALTER TABLE "Feature" RENAME TO "Feature_legacy";

-- CreateTable: the new tenant-scoped Feature, empty until the data script runs.
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "singularLabel" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isSingleton" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Feature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Feature_tenantId_idx" ON "Feature"("tenantId");
CREATE UNIQUE INDEX "Feature_tenantId_key_key" ON "Feature"("tenantId", "key");

-- RedefineTable: WebsiteIntegration -- same columns/data, featureId FK
-- retargeted from Feature_legacy to the new Feature table.
CREATE TABLE "new_WebsiteIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "loginUrl" TEXT,
    "loginEmailEncrypted" TEXT,
    "loginPasswordEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" DATETIME,
    "refreshTokenEncrypted" TEXT,
    "credentialStatus" TEXT NOT NULL DEFAULT 'OK',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "permissionLevel" TEXT NOT NULL DEFAULT 'VIEW',
    "fieldMapping" TEXT,
    "responseMapping" TEXT,
    "lastImportedAt" DATETIME,
    "lastImportRecordCount" INTEGER,
    "discoveredSchema" TEXT,
    "schemaDiscoveredAt" DATETIME,
    "lookupKey" TEXT,
    "confidentialFields" TEXT,
    "confidentialWriteEnabled" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteIntegration" SELECT * FROM "WebsiteIntegration";
DROP TABLE "WebsiteIntegration";
ALTER TABLE "new_WebsiteIntegration" RENAME TO "WebsiteIntegration";
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_featureId_key" ON "WebsiteIntegration"("tenantId", "featureId");

-- RedefineTable: WebsiteContentItem -- same columns/data, featureId FK retargeted.
CREATE TABLE "new_WebsiteContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" TEXT NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteContentItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteContentItem_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteContentItem" SELECT * FROM "WebsiteContentItem";
DROP TABLE "WebsiteContentItem";
ALTER TABLE "new_WebsiteContentItem" RENAME TO "WebsiteContentItem";
CREATE INDEX "WebsiteContentItem_tenantId_idx" ON "WebsiteContentItem"("tenantId");
CREATE INDEX "WebsiteContentItem_tenantId_featureId_idx" ON "WebsiteContentItem"("tenantId", "featureId");

-- RedefineTable: ConnectorAccessLog -- same columns/data, featureId FK retargeted.
CREATE TABLE "new_ConnectorAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "websiteIntegrationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectorAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectorAccessLog_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectorAccessLog_websiteIntegrationId_fkey" FOREIGN KEY ("websiteIntegrationId") REFERENCES "WebsiteIntegration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ConnectorAccessLog" SELECT * FROM "ConnectorAccessLog";
DROP TABLE "ConnectorAccessLog";
ALTER TABLE "new_ConnectorAccessLog" RENAME TO "ConnectorAccessLog";
CREATE INDEX "ConnectorAccessLog_tenantId_featureId_idx" ON "ConnectorAccessLog"("tenantId", "featureId");
CREATE INDEX "ConnectorAccessLog_tenantId_createdAt_idx" ON "ConnectorAccessLog"("tenantId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
