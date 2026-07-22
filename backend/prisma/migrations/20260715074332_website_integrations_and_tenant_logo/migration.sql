-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "logoUrl" TEXT;

-- CreateTable
CREATE TABLE "WebsiteIntegration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebsiteContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" TEXT NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebsiteContentItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_contentType_key" ON "WebsiteIntegration"("tenantId", "contentType");

-- CreateIndex
CREATE INDEX "WebsiteContentItem_tenantId_idx" ON "WebsiteContentItem"("tenantId");

-- CreateIndex
CREATE INDEX "WebsiteContentItem_tenantId_contentType_idx" ON "WebsiteContentItem"("tenantId", "contentType");
