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
    "dataSourceId" TEXT,
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
    CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WebsiteIntegration_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WebsiteIntegration" ("active", "authType", "baseUrl", "confidentialFields", "confidentialWriteEnabled", "createdAt", "credentialStatus", "dataSourceId", "discoveredSchema", "encryptedCredentials", "featureId", "fieldMapping", "id", "lastImportRecordCount", "lastImportedAt", "lookupKey", "permissionLevel", "responseMapping", "schemaDiscoveredAt", "tenantId", "updatedAt") SELECT "active", "authType", "baseUrl", "confidentialFields", "confidentialWriteEnabled", "createdAt", "credentialStatus", "dataSourceId", "discoveredSchema", "encryptedCredentials", "featureId", "fieldMapping", "id", "lastImportRecordCount", "lastImportedAt", "lookupKey", "permissionLevel", "responseMapping", "schemaDiscoveredAt", "tenantId", "updatedAt" FROM "WebsiteIntegration";
DROP TABLE "WebsiteIntegration";
ALTER TABLE "new_WebsiteIntegration" RENAME TO "WebsiteIntegration";
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");
CREATE INDEX "WebsiteIntegration_dataSourceId_idx" ON "WebsiteIntegration"("dataSourceId");
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_featureId_key" ON "WebsiteIntegration"("tenantId", "featureId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

