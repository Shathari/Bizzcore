-- CreateTable
CREATE TABLE "CustomerCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerCategory_tenantId_idx" ON "CustomerCategory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCategory_tenantId_name_key" ON "CustomerCategory"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "CustomerCategory" ADD CONSTRAINT "CustomerCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
