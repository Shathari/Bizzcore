-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PendingSetup',
    "planId" TEXT,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'Trialing',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "address" TEXT,
    "customDomain" TEXT,
    "logoUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activeManualGrantId" TEXT,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "email" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'Regular',
    "birthday" TEXT,
    "birthdayMonthDay" TEXT,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPurchase" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "channel" TEXT NOT NULL,
    "contactName" TEXT,
    "contactHandle" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "path" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "singularLabel" TEXT,
    "isSingleton" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "singularLabel" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isSingleton" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "encryptedCredentials" TEXT,
    "dataSourceId" TEXT,
    "credentialStatus" TEXT NOT NULL DEFAULT 'OK',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "permissionLevel" TEXT NOT NULL DEFAULT 'VIEW',
    "fieldMapping" TEXT,
    "responseMapping" TEXT,
    "lastImportedAt" TIMESTAMP(3),
    "lastImportRecordCount" INTEGER,
    "discoveredSchema" TEXT,
    "schemaDiscoveredAt" TIMESTAMP(3),
    "lookupKey" TEXT,
    "confidentialFields" TEXT,
    "confidentialWriteEnabled" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "loginUrl" TEXT,
    "loginEmailEncrypted" TEXT,
    "loginPasswordEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "refreshTokenEncrypted" TEXT,
    "credentialStatus" TEXT NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteIntegrationSchemaSnapshot" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteIntegrationSchemaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteIntegrationEndpoint" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT,
    "authType" TEXT,
    "encryptedCredentials" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteIntegrationEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteContentItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" TEXT NOT NULL,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "mediaUploads" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledContent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "postType" TEXT,
    "caption" TEXT,
    "mediaUrl" TEXT,
    "targetSegment" TEXT,
    "targetCustomerId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "postCaption" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIGeneration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "contentType" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "productName" TEXT,
    "context" TEXT,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "customerId" TEXT,
    "field" TEXT,
    "reason" TEXT NOT NULL,
    "recordCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorAccessLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "websiteIntegrationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureCatalog" (
    "featureKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeatureCatalog_pkey" PRIMARY KEY ("featureKey")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "priceYearly" DOUBLE PRECISION NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFeatureOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "included" BOOLEAN,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeatureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceOneTime" DOUBLE PRECISION,
    "priceRecurring" DOUBLE PRECISION,
    "billingType" TEXT NOT NULL,
    "relatedFeatureKey" TEXT,
    "topUpAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAddOn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMP(3),

    CONSTRAINT "TenantAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDevelopmentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "quotedAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDevelopmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "planId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpaySignature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawWebhookPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantedBySuperAdminId" TEXT NOT NULL,
    "planId" TEXT,
    "durationDays" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "previousPlanId" TEXT,
    "previousSubscriptionStatus" TEXT,
    "previousPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_activeManualGrantId_key" ON "Tenant"("activeManualGrantId");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_segment_idx" ON "Customer"("tenantId", "segment");

-- CreateIndex
CREATE INDEX "Customer_tenantId_phoneHash_idx" ON "Customer"("tenantId", "phoneHash");

-- CreateIndex
CREATE INDEX "Customer_tenantId_birthdayMonthDay_idx" ON "Customer"("tenantId", "birthdayMonthDay");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_idx" ON "Purchase"("tenantId");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_purchasedAt_idx" ON "Purchase"("tenantId", "purchasedAt");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_channel_idx" ON "Conversation"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "Message_tenantId_idx" ON "Message"("tenantId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Inquiry_tenantId_idx" ON "Inquiry"("tenantId");

-- CreateIndex
CREATE INDEX "Inquiry_tenantId_createdAt_idx" ON "Inquiry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteVisit_tenantId_idx" ON "WebsiteVisit"("tenantId");

-- CreateIndex
CREATE INDEX "WebsiteVisit_tenantId_visitedAt_idx" ON "WebsiteVisit"("tenantId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureTemplate_key_key" ON "FeatureTemplate"("key");

-- CreateIndex
CREATE INDEX "Feature_tenantId_idx" ON "Feature"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_tenantId_key_key" ON "Feature"("tenantId", "key");

-- CreateIndex
CREATE INDEX "WebsiteIntegration_tenantId_idx" ON "WebsiteIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "WebsiteIntegration_dataSourceId_idx" ON "WebsiteIntegration"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteIntegration_tenantId_featureId_key" ON "WebsiteIntegration"("tenantId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_tenantId_origin_key" ON "DataSource"("tenantId", "origin");

-- CreateIndex
CREATE INDEX "WebsiteIntegrationSchemaSnapshot_integrationId_discoveredAt_idx" ON "WebsiteIntegrationSchemaSnapshot"("integrationId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteIntegrationEndpoint_integrationId_method_key" ON "WebsiteIntegrationEndpoint"("integrationId", "method");

-- CreateIndex
CREATE INDEX "WebsiteContentItem_tenantId_idx" ON "WebsiteContentItem"("tenantId");

-- CreateIndex
CREATE INDEX "WebsiteContentItem_tenantId_featureId_idx" ON "WebsiteContentItem"("tenantId", "featureId");

-- CreateIndex
CREATE INDEX "ScheduledContent_tenantId_idx" ON "ScheduledContent"("tenantId");

-- CreateIndex
CREATE INDEX "ScheduledContent_status_scheduledAt_idx" ON "ScheduledContent"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SocialComment_tenantId_idx" ON "SocialComment"("tenantId");

-- CreateIndex
CREATE INDEX "SocialComment_tenantId_channel_idx" ON "SocialComment"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "AIGeneration_tenantId_idx" ON "AIGeneration"("tenantId");

-- CreateIndex
CREATE INDEX "AIGeneration_tenantId_createdAt_idx" ON "AIGeneration"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationCredential_tenantId_idx" ON "IntegrationCredential"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_tenantId_provider_key" ON "IntegrationCredential"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "AuditLog_targetTenantId_idx" ON "AuditLog"("targetTenantId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AccessLog_tenantId_customerId_idx" ON "AccessLog"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "AccessLog_tenantId_createdAt_idx" ON "AccessLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorAccessLog_tenantId_featureId_idx" ON "ConnectorAccessLog"("tenantId", "featureId");

-- CreateIndex
CREATE INDEX "ConnectorAccessLog_tenantId_createdAt_idx" ON "ConnectorAccessLog"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureOverride_tenantId_featureKey_key" ON "TenantFeatureOverride"("tenantId", "featureKey");

-- CreateIndex
CREATE INDEX "TenantAddOn_tenantId_status_idx" ON "TenantAddOn"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomDevelopmentRequest_tenantId_status_idx" ON "CustomDevelopmentRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "UsageCounter_tenantId_featureKey_idx" ON "UsageCounter"("tenantId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_tenantId_featureKey_periodStart_key" ON "UsageCounter"("tenantId", "featureKey", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_razorpayOrderId_key" ON "Invoice"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_createdAt_idx" ON "Payment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualGrant_tenantId_idx" ON "ManualGrant"("tenantId");

-- CreateIndex
CREATE INDEX "ManualGrant_tenantId_status_idx" ON "ManualGrant"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ManualGrant_status_expiresAt_idx" ON "ManualGrant"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_activeManualGrantId_fkey" FOREIGN KEY ("activeManualGrantId") REFERENCES "ManualGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteVisit" ADD CONSTRAINT "WebsiteVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feature" ADD CONSTRAINT "Feature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteIntegration" ADD CONSTRAINT "WebsiteIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteIntegration" ADD CONSTRAINT "WebsiteIntegration_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteIntegration" ADD CONSTRAINT "WebsiteIntegration_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteIntegrationSchemaSnapshot" ADD CONSTRAINT "WebsiteIntegrationSchemaSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WebsiteIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteIntegrationEndpoint" ADD CONSTRAINT "WebsiteIntegrationEndpoint_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WebsiteIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteContentItem" ADD CONSTRAINT "WebsiteContentItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteContentItem" ADD CONSTRAINT "WebsiteContentItem_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledContent" ADD CONSTRAINT "ScheduledContent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneration" ADD CONSTRAINT "AIGeneration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneration" ADD CONSTRAINT "AIGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorAccessLog" ADD CONSTRAINT "ConnectorAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorAccessLog" ADD CONSTRAINT "ConnectorAccessLog_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorAccessLog" ADD CONSTRAINT "ConnectorAccessLog_websiteIntegrationId_fkey" FOREIGN KEY ("websiteIntegrationId") REFERENCES "WebsiteIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAddOn" ADD CONSTRAINT "TenantAddOn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAddOn" ADD CONSTRAINT "TenantAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDevelopmentRequest" ADD CONSTRAINT "CustomDevelopmentRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualGrant" ADD CONSTRAINT "ManualGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualGrant" ADD CONSTRAINT "ManualGrant_grantedBySuperAdminId_fkey" FOREIGN KEY ("grantedBySuperAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualGrant" ADD CONSTRAINT "ManualGrant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
