/*
  Warnings:

  - Made the column `phoneHash` on table `Customer` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phoneMasked` on table `Customer` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
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
INSERT INTO "new_Customer" ("birthday", "birthdayMonthDay", "createdAt", "email", "id", "lastPurchase", "name", "notes", "phone", "phoneHash", "phoneMasked", "segment", "tenantId", "totalSpent", "updatedAt") SELECT "birthday", "birthdayMonthDay", "createdAt", "email", "id", "lastPurchase", "name", "notes", "phone", "phoneHash", "phoneMasked", "segment", "tenantId", "totalSpent", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX "Customer_tenantId_segment_idx" ON "Customer"("tenantId", "segment");
CREATE INDEX "Customer_tenantId_phoneHash_idx" ON "Customer"("tenantId", "phoneHash");
CREATE INDEX "Customer_tenantId_birthdayMonthDay_idx" ON "Customer"("tenantId", "birthdayMonthDay");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
