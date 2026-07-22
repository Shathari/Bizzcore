-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PendingSetup',
    "plan" TEXT,
    "logoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tenant" ("businessName", "createdAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "plan", "status", "updatedAt", "websiteUrl") SELECT "businessName", "createdAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "plan", "status", "updatedAt", "websiteUrl" FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
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
INSERT INTO "new_WebsiteContentItem" ("createdAt", "externalId", "featureId", "id", "lastError", "lastSyncedAt", "payload", "syncStatus", "tenantId", "updatedAt") SELECT "createdAt", "externalId", "featureId", "id", "lastError", "lastSyncedAt", "payload", "syncStatus", "tenantId", "updatedAt" FROM "WebsiteContentItem";
DROP TABLE "WebsiteContentItem";
ALTER TABLE "new_WebsiteContentItem" RENAME TO "WebsiteContentItem";
CREATE INDEX "WebsiteContentItem_tenantId_idx" ON "WebsiteContentItem"("tenantId");
CREATE INDEX "WebsiteContentItem_tenantId_featureId_idx" ON "WebsiteContentItem"("tenantId", "featureId");
CREATE TABLE "new_WebsiteIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canBusinessAdminManage" BOOLEAN NOT NULL DEFAULT false,
    "fieldMapping" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteIntegration" ("active", "authType", "baseUrl", "canBusinessAdminManage", "createdAt", "encryptedCredentials", "featureId", "fieldMapping", "id", "tenantId", "updatedAt") SELECT "active", "authType", "baseUrl", "canBusinessAdminManage", "createdAt", "encryptedCredentials", "featureId", "fieldMapping", "id", "tenantId", "updatedAt" FROM "WebsiteIntegration";
DROP TABLE "WebsiteIntegration";
ALTER TABLE "new_WebsiteIntegration" RENAME TO "WebsiteIntegration";
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_featureId_key" ON "WebsiteIntegration"("tenantId", "featureId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

