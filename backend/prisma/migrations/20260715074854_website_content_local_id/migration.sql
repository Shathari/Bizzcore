-- AlterTable
ALTER TABLE "WebsiteContentItem" ADD COLUMN "localId" TEXT;

-- CreateIndex
CREATE INDEX "WebsiteContentItem_tenantId_contentType_localId_idx" ON "WebsiteContentItem"("tenantId", "contentType", "localId");
