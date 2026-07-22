import { updateFeature } from "./src/lib/featureCatalog";
import { updateItem, syncItems } from "./src/lib/websiteContentService";
import { prisma } from "./src/lib/prisma";

async function main() {
  const tenantId = "cmrsu51qo0001wnpvglwrbfkg";
  const featureId = "cmrvzy3mc0001odl7vgkmshhv";
  const itemId = "cmrw0aco90010odl7we66645d";
  const actorId = "cmrsu51r40003wnpvi97lhiha";

  const updatedFeature = await updateFeature(featureId, tenantId, { isSingleton: true });
  console.log("1) Feature.isSingleton now:", updatedFeature?.isSingleton);

  const updateResult = await updateItem(
    tenantId,
    "ABOUT",
    itemId,
    {
      heroTitle: "hello",
      heroSubtitle: "hello",
      companyIntro: "hello",
      missionText: "hello",
      visionText: "hello",
      coreValues: "hello",
      servicesIntro: "hello",
      services: "hello",
      environmentalImpact: "hello",
    },
    actorId
  );
  console.log("2) updateItem result:", JSON.stringify(updateResult, null, 2));

  const syncResult = await syncItems(tenantId, "ABOUT", actorId);
  console.log("3) syncItems result:", JSON.stringify(syncResult, null, 2));
}

main().finally(() => prisma.$disconnect());
