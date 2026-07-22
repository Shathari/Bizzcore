-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "postCaption" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reply" TEXT,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SocialComment_tenantId_idx" ON "SocialComment"("tenantId");

-- CreateIndex
CREATE INDEX "SocialComment_tenantId_channel_idx" ON "SocialComment"("tenantId", "channel");
