// Part 2 of the Feature tenant-scoping migration (see migration
// 20260722034035_tenant_scope_features's SQL comment for part 1).
//
// "Feature_legacy" (created by that migration) holds the original 9
// globally-shared rows exactly as they were. This script:
//   1. Seeds FeatureTemplate (the new, genuinely-global, FK-less catalog)
//      from the canonical builtInFeatures.ts source -- NOT from
//      Feature_legacy's current (possibly drifted) field lists, since
//      Feature_legacy may already reflect one tenant's edits bleeding
//      into another's schema (exactly the bug this migration fixes).
//   2. For every Feature_legacy row, finds every tenant that actually
//      referenced it (via WebsiteIntegration, WebsiteContentItem, or
//      ConnectorAccessLog) and creates that tenant's own independent
//      Feature row -- reconciled to include any field a tenant's real
//      WebsiteContentItem.payload data still uses even if the current
//      (drifted) global field list had already dropped it, so no tenant
//      silently loses access to editing a field their real content has.
//   3. Repoints every WebsiteIntegration/WebsiteContentItem/
//      ConnectorAccessLog.featureId from the old shared id to that
//      tenant's new one.
//   4. A custom (non-built-in) Feature with zero referencing tenants is
//      dropped outright -- consistent with the app's own existing rule
//      that an unused custom feature is safe to delete (see
//      lib/featureCatalog.ts's deleteFeature).
//
// Idempotent: skips straight to verification if Feature_legacy doesn't
// exist (already migrated and cleaned up).
//
// Run with: npx tsx prisma/scripts/tenant-scope-features.ts

import { PrismaClient } from "@prisma/client";
import { BUILT_IN_FEATURES } from "../builtInFeatures";
import type { FieldDef } from "../../src/lib/featureCatalog";

const prisma = new PrismaClient();

type LegacyFeatureRow = {
  id: string;
  key: string;
  label: string;
  singularLabel: string | null;
  isBuiltIn: number; // SQLite boolean -> 0/1 over a raw query
  isSingleton: number;
  fields: string;
  createdAt: string;
  updatedAt: string;
};

function titleize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Best-effort FieldDef for a payload key with no matching entry in either
// the current global field list or the canonical built-in template --
// infers from the actual JSON value found, so at minimum the recovered
// field renders with a sane input type instead of defaulting everything
// to text.
function inferFieldDef(key: string, sampleValue: unknown): FieldDef {
  if (typeof sampleValue === "boolean") return { key, label: titleize(key), type: "checkbox" };
  if (typeof sampleValue === "number") return { key, label: titleize(key), type: "number" };
  return { key, label: titleize(key), type: "text" };
}

async function main() {
  const legacyExists =
    (await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='Feature_legacy'`
    )).length > 0;

  if (!legacyExists) {
    console.log("Feature_legacy not found -- already migrated (or never needed). Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // --- Step 1: seed FeatureTemplate from the canonical source, not from
  // Feature_legacy's (possibly drifted) current state. ---
  for (const tmpl of BUILT_IN_FEATURES) {
    await prisma.featureTemplate.upsert({
      where: { key: tmpl.key },
      update: {
        label: tmpl.label,
        singularLabel: tmpl.singularLabel ?? null,
        isSingleton: tmpl.isSingleton,
        fields: JSON.stringify(tmpl.fields),
      },
      create: {
        key: tmpl.key,
        label: tmpl.label,
        singularLabel: tmpl.singularLabel ?? null,
        isSingleton: tmpl.isSingleton,
        fields: JSON.stringify(tmpl.fields),
      },
    });
  }
  console.log(`FeatureTemplate seeded: ${BUILT_IN_FEATURES.length} built-ins.`);

  const templateByKey = new Map(BUILT_IN_FEATURES.map((t) => [t.key, t]));

  const legacyRows = await prisma.$queryRawUnsafe<LegacyFeatureRow[]>(`SELECT * FROM Feature_legacy`);
  console.log(`\nFeature_legacy: ${legacyRows.length} row(s) to process.\n`);

  let clonesCreated = 0;
  let fieldsRecovered = 0;
  let unusedCustomDropped = 0;

  for (const legacy of legacyRows) {
    const baseFields: FieldDef[] = JSON.parse(legacy.fields);
    const baseKeys = new Set(baseFields.map((f) => f.key));

    const [wiTenants, wciTenants, calTenants] = await Promise.all([
      prisma.websiteIntegration.findMany({ where: { featureId: legacy.id }, select: { tenantId: true }, distinct: ["tenantId"] }),
      prisma.websiteContentItem.findMany({ where: { featureId: legacy.id }, select: { tenantId: true }, distinct: ["tenantId"] }),
      prisma.connectorAccessLog.findMany({ where: { featureId: legacy.id }, select: { tenantId: true }, distinct: ["tenantId"] }),
    ]);
    const tenantIds = [...new Set([...wiTenants, ...wciTenants, ...calTenants].map((r) => r.tenantId))];

    if (tenantIds.length === 0) {
      if (!legacy.isBuiltIn) {
        unusedCustomDropped += 1;
        console.log(`  [${legacy.key}] custom, unused by any tenant -- dropped (same rule as deleteFeature).`);
      } else {
        console.log(`  [${legacy.key}] built-in, unused by any tenant -- no clone needed (still available via FeatureTemplate).`);
      }
      continue;
    }

    for (const tenantId of tenantIds) {
      const items = await prisma.websiteContentItem.findMany({
        where: { tenantId, featureId: legacy.id },
        select: { payload: true },
      });
      const payloadKeys = new Map<string, unknown>();
      for (const item of items) {
        const parsed = JSON.parse(item.payload) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (!payloadKeys.has(k)) payloadKeys.set(k, v);
        }
      }

      const recovered: FieldDef[] = [];
      for (const [payloadKey, sampleValue] of payloadKeys) {
        if (baseKeys.has(payloadKey)) continue;
        const templateField = legacy.isBuiltIn
          ? templateByKey.get(legacy.key)?.fields.find((f) => f.key === payloadKey)
          : undefined;
        recovered.push(templateField ?? inferFieldDef(payloadKey, sampleValue));
      }

      const finalFields = [...baseFields, ...recovered];
      if (recovered.length > 0) {
        fieldsRecovered += recovered.length;
        console.log(
          `  [${legacy.key}] tenant ${tenantId}: recovered ${recovered.length} field(s) still used in real data but missing from the shared list -- ${recovered.map((f) => f.key).join(", ")}`
        );
      }

      const created = await prisma.feature.create({
        data: {
          tenantId,
          key: legacy.key,
          label: legacy.label,
          singularLabel: legacy.singularLabel,
          isBuiltIn: Boolean(legacy.isBuiltIn),
          isSingleton: Boolean(legacy.isSingleton),
          fields: JSON.stringify(finalFields),
          createdAt: new Date(Number(legacy.createdAt)),
        },
      });
      clonesCreated += 1;

      await Promise.all([
        prisma.websiteIntegration.updateMany({ where: { tenantId, featureId: legacy.id }, data: { featureId: created.id } }),
        prisma.websiteContentItem.updateMany({ where: { tenantId, featureId: legacy.id }, data: { featureId: created.id } }),
        prisma.connectorAccessLog.updateMany({ where: { tenantId, featureId: legacy.id }, data: { featureId: created.id } }),
      ]);
    }
  }

  // --- Verification: nothing should still point at a Feature_legacy id. ---
  const legacyIds = new Set(legacyRows.map((r) => r.id));
  const [remainingWI, remainingWCI, remainingCAL] = await Promise.all([
    prisma.websiteIntegration.findMany({ select: { id: true, featureId: true } }),
    prisma.websiteContentItem.findMany({ select: { id: true, featureId: true } }),
    prisma.connectorAccessLog.findMany({ select: { id: true, featureId: true } }),
  ]);
  const danglingWI = remainingWI.filter((r) => legacyIds.has(r.featureId));
  const danglingWCI = remainingWCI.filter((r) => legacyIds.has(r.featureId));
  const danglingCAL = remainingCAL.filter((r) => legacyIds.has(r.featureId));

  console.log(`\n--- Summary ---`);
  console.log(`Feature clones created: ${clonesCreated}`);
  console.log(`Fields recovered from real data: ${fieldsRecovered}`);
  console.log(`Unused custom Feature rows dropped: ${unusedCustomDropped}`);
  console.log(`Dangling references still pointing at Feature_legacy -- WI: ${danglingWI.length}, WCI: ${danglingWCI.length}, CAL: ${danglingCAL.length}`);

  if (danglingWI.length || danglingWCI.length || danglingCAL.length) {
    console.error("\nRefusing to report success -- dangling references found. Feature_legacy was NOT dropped. Investigate before re-running.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\nAll references repointed successfully. Feature_legacy can now be dropped by the follow-up migration.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
