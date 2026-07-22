/*
  Warnings:

  - You are about to drop the column `plan` on the `Tenant` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "FeatureCatalog" (
    "featureKey" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" REAL NOT NULL,
    "priceYearly" REAL NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantFeatureOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "included" BOOLEAN,
    "value" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantFeatureOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceOneTime" REAL,
    "priceRecurring" REAL,
    "billingType" TEXT NOT NULL,
    "relatedFeatureKey" TEXT,
    "topUpAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TenantAddOn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "purchasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" DATETIME,
    CONSTRAINT "TenantAddOn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomDevelopmentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "quotedAmount" REAL,
    "notes" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomDevelopmentRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "planId" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'Trialing',
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "address" TEXT,
    "customDomain" TEXT,
    "logoUrl" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Tenant" ("address", "businessName", "createdAt", "customDomain", "deletedAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "status", "updatedAt", "websiteUrl") SELECT "address", "businessName", "createdAt", "customDomain", "deletedAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "status", "updatedAt", "websiteUrl" FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureOverride_tenantId_featureKey_key" ON "TenantFeatureOverride"("tenantId", "featureKey");

-- CreateIndex
CREATE INDEX "TenantAddOn_tenantId_status_idx" ON "TenantAddOn"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomDevelopmentRequest_tenantId_status_idx" ON "CustomDevelopmentRequest"("tenantId", "status");
