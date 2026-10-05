-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "consentPageToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_consentPageToken_key" ON "Tenant"("consentPageToken");
