-- AlterTable
ALTER TABLE "IntegrationCredential" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_channel_contactHandle_key" ON "Conversation"("tenantId", "channel", "contactHandle");

-- CreateIndex
CREATE INDEX "IntegrationCredential_provider_externalId_idx" ON "IntegrationCredential"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Message_tenantId_externalId_idx" ON "Message"("tenantId", "externalId");
