-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "singularLabel" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isSingleton" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebsiteContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT,
    "contentType" TEXT,
    "externalId" TEXT,
    "payload" TEXT NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteContentItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteContentItem_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteContentItem" ("contentType", "createdAt", "externalId", "id", "lastError", "lastSyncedAt", "payload", "syncStatus", "tenantId", "updatedAt") SELECT "contentType", "createdAt", "externalId", "id", "lastError", "lastSyncedAt", "payload", "syncStatus", "tenantId", "updatedAt" FROM "WebsiteContentItem";
DROP TABLE "WebsiteContentItem";
ALTER TABLE "new_WebsiteContentItem" RENAME TO "WebsiteContentItem";
CREATE INDEX "WebsiteContentItem_tenantId_idx" ON "WebsiteContentItem"("tenantId");
CREATE INDEX "WebsiteContentItem_tenantId_featureId_idx" ON "WebsiteContentItem"("tenantId", "featureId");
CREATE TABLE "new_WebsiteIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT,
    "contentType" TEXT,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canBusinessAdminManage" BOOLEAN NOT NULL DEFAULT false,
    "fieldMapping" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteIntegration" ("active", "authType", "baseUrl", "contentType", "createdAt", "encryptedCredentials", "id", "tenantId", "updatedAt") SELECT "active", "authType", "baseUrl", "contentType", "createdAt", "encryptedCredentials", "id", "tenantId", "updatedAt" FROM "WebsiteIntegration";
DROP TABLE "WebsiteIntegration";
ALTER TABLE "new_WebsiteIntegration" RENAME TO "WebsiteIntegration";
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");
