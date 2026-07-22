-- CreateTable
CREATE TABLE "ConnectorAccessLog" (
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "customerId" TEXT,
    "field" TEXT,
    "reason" TEXT NOT NULL,
    "recordCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccessLog" ("actorId", "createdAt", "customerId", "field", "id", "reason", "tenantId") SELECT "actorId", "createdAt", "customerId", "field", "id", "reason", "tenantId" FROM "AccessLog";
DROP TABLE "AccessLog";
ALTER TABLE "new_AccessLog" RENAME TO "AccessLog";
CREATE INDEX "AccessLog_tenantId_customerId_idx" ON "AccessLog"("tenantId", "customerId");
CREATE INDEX "AccessLog_tenantId_createdAt_idx" ON "AccessLog"("tenantId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ConnectorAccessLog_tenantId_featureId_idx" ON "ConnectorAccessLog"("tenantId", "featureId");

-- CreateIndex
CREATE INDEX "ConnectorAccessLog_tenantId_createdAt_idx" ON "ConnectorAccessLog"("tenantId", "createdAt");
