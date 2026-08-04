-- AlterTable
ALTER TABLE "AIGeneration" ADD COLUMN     "researchReportId" TEXT,
ADD COLUMN     "selectedPatternIds" TEXT;

-- CreateTable
CREATE TABLE "ContentResearchReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "seedLinks" TEXT NOT NULL,
    "summary" TEXT,
    "patterns" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentResearchLink" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "fetchStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "viewCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "shareCount" INTEGER,
    "durationSeconds" INTEGER,
    "postedAt" TIMESTAMP(3),
    "hashtags" TEXT,
    "captionText" TEXT,
    "rawMetadata" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentResearchLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentResearchReport_tenantId_idx" ON "ContentResearchReport"("tenantId");

-- CreateIndex
CREATE INDEX "ContentResearchReport_tenantId_createdAt_idx" ON "ContentResearchReport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentResearchLink_reportId_idx" ON "ContentResearchLink"("reportId");

-- CreateIndex
CREATE INDEX "AIGeneration_researchReportId_idx" ON "AIGeneration"("researchReportId");

-- AddForeignKey
ALTER TABLE "AIGeneration" ADD CONSTRAINT "AIGeneration_researchReportId_fkey" FOREIGN KEY ("researchReportId") REFERENCES "ContentResearchReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentResearchReport" ADD CONSTRAINT "ContentResearchReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentResearchReport" ADD CONSTRAINT "ContentResearchReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentResearchLink" ADD CONSTRAINT "ContentResearchLink_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ContentResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
