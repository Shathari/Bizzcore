-- Existing sales retain NULL; PostgreSQL permits multiple NULL values.
ALTER TABLE "Purchase" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "Purchase_tenantId_requestId_key" ON "Purchase"("tenantId", "requestId");
