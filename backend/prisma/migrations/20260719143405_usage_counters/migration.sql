-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UsageCounter_tenantId_featureKey_idx" ON "UsageCounter"("tenantId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_tenantId_featureKey_periodStart_key" ON "UsageCounter"("tenantId", "featureKey", "periodStart");
