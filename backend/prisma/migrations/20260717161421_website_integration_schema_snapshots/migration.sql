-- CreateTable
CREATE TABLE "WebsiteIntegrationSchemaSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationId" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsiteIntegrationSchemaSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WebsiteIntegration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WebsiteIntegrationSchemaSnapshot_integrationId_discoveredAt_idx" ON "WebsiteIntegrationSchemaSnapshot"("integrationId", "discoveredAt");

