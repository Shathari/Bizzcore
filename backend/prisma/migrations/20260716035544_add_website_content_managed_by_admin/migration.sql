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
    "plan" TEXT,
    "websiteContentManagedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Tenant" ("businessName", "createdAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "plan", "status", "updatedAt", "websiteUrl") SELECT "businessName", "createdAt", "id", "logoUrl", "ownerEmail", "ownerPhone", "plan", "status", "updatedAt", "websiteUrl" FROM "Tenant";
DROP TABLE "Tenant";
ALTER TABLE "new_Tenant" RENAME TO "Tenant";
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
