-- Unifies all 9 Website Manager content types under the generic
-- WebsiteIntegration/WebsiteContentItem model: Products, Collections,
-- Banners, and Offers no longer have their own dedicated tables — they're
-- now content types like any other, mapped by Super Admin and mirrored in
-- WebsiteContentItem exactly like Categories/Testimonials/Blogs/FAQs/
-- Contact Details always were.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Product";
DROP TABLE "Collection";
DROP TABLE "Banner";
DROP TABLE "Offer";
PRAGMA foreign_keys=on;

-- DropIndex
DROP INDEX "WebsiteContentItem_tenantId_contentType_localId_idx";

-- AlterTable
ALTER TABLE "WebsiteContentItem" DROP COLUMN "localId";
