-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "broadcastId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledContent" ADD COLUMN     "offerCode" TEXT,
ADD COLUMN     "offerDescription" TEXT,
ADD COLUMN     "offerEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offerEndsAt" TIMESTAMP(3),
ADD COLUMN     "offerStartsAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "offerCode" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BroadcastRecipient_tenantId_customerId_sentAt_idx" ON "BroadcastRecipient"("tenantId", "customerId", "sentAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_tenantId_externalId_idx" ON "BroadcastRecipient"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_tenantId_broadcastId_customerId_key" ON "BroadcastRecipient"("tenantId", "broadcastId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_purchaseId_key" ON "OfferRedemption"("purchaseId");

-- CreateIndex
CREATE INDEX "OfferRedemption_tenantId_broadcastId_idx" ON "OfferRedemption"("tenantId", "broadcastId");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_broadcastId_idx" ON "Purchase"("tenantId", "broadcastId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledContent_tenantId_offerCode_key" ON "ScheduledContent"("tenantId", "offerCode");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "ScheduledContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "ScheduledContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "ScheduledContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
