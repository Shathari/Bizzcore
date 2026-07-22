-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "loginUrl" TEXT,
    "loginEmailEncrypted" TEXT,
    "loginPasswordEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" DATETIME,
    "refreshTokenEncrypted" TEXT,
    "credentialStatus" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DataSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_tenantId_origin_key" ON "DataSource"("tenantId", "origin");

-- AlterTable (nullable, unconstrained for now — the proper FK is added when
-- WebsiteIntegration is rebuilt in the next migration; this step is purely
-- additive so existing rows and the app keep working while the data
-- migration script runs)
ALTER TABLE "WebsiteIntegration" ADD COLUMN "dataSourceId" TEXT;

-- CreateIndex
CREATE INDEX "WebsiteIntegration_dataSourceId_idx" ON "WebsiteIntegration"("dataSourceId");
