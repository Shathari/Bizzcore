-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "customerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneMasked" TEXT,
    "phoneHash" TEXT,
    "email" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'Regular',
    "birthday" TEXT,
    "birthdayMonthDay" TEXT,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "lastPurchase" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("birthday", "createdAt", "email", "id", "lastPurchase", "name", "notes", "phone", "segment", "tenantId", "totalSpent", "updatedAt") SELECT "birthday", "createdAt", "email", "id", "lastPurchase", "name", "notes", "phone", "segment", "tenantId", "totalSpent", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX "Customer_tenantId_segment_idx" ON "Customer"("tenantId", "segment");
CREATE INDEX "Customer_tenantId_phoneHash_idx" ON "Customer"("tenantId", "phoneHash");
CREATE INDEX "Customer_tenantId_birthdayMonthDay_idx" ON "Customer"("tenantId", "birthdayMonthDay");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AccessLog_tenantId_customerId_idx" ON "AccessLog"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "AccessLog_tenantId_createdAt_idx" ON "AccessLog"("tenantId", "createdAt");
