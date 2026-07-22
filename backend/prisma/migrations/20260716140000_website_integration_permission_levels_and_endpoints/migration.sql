-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebsiteIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "permissionLevel" TEXT NOT NULL DEFAULT 'VIEW',
    "fieldMapping" TEXT,
    "lastImportedAt" DATETIME,
    "lastImportRecordCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Data migration: canBusinessAdminManage=true -> MANAGE, false -> VIEW (the
-- "No Access" state going forward is `active = false`, unchanged).
INSERT INTO "new_WebsiteIntegration" ("id", "tenantId", "featureId", "baseUrl", "authType", "encryptedCredentials", "active", "permissionLevel", "fieldMapping", "createdAt", "updatedAt")
SELECT "id", "tenantId", "featureId", "baseUrl", "authType", "encryptedCredentials", "active", CASE WHEN "canBusinessAdminManage" = 1 THEN 'MANAGE' ELSE 'VIEW' END, "fieldMapping", "createdAt", "updatedAt" FROM "WebsiteIntegration";
DROP TABLE "WebsiteIntegration";
ALTER TABLE "new_WebsiteIntegration" RENAME TO "WebsiteIntegration";
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_featureId_key" ON "WebsiteIntegration"("tenantId", "featureId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "WebsiteIntegrationEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT,
    "authType" TEXT,
    "encryptedCredentials" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegrationEndpoint_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WebsiteIntegration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteIntegrationEndpoint_integrationId_method_key" ON "WebsiteIntegrationEndpoint"("integrationId", "method");
