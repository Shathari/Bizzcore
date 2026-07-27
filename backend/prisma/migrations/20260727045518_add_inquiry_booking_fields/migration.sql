-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "preferredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Inquiry_tenantId_status_idx" ON "Inquiry"("tenantId", "status");
