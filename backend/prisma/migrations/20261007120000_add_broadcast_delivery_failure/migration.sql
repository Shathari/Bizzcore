-- AlterTable
ALTER TABLE "BroadcastRecipient" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureCategory" TEXT,
ADD COLUMN     "failureCode" INTEGER;
