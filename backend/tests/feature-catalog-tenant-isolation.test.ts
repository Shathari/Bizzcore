import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs } from "./helpers";
import { prisma } from "../src/lib/prisma";

// Live, end-to-end proof of the three-layer isolation model documented in
// lib/featureCatalog.ts and schema.prisma (FeatureTemplate = global master
// template; Feature = tenant-scoped clone-on-first-access copy):
//
//   1. Two tenants independently provisioned from the same built-in
//      FeatureTemplate end up with two distinct, equal-at-birth Feature rows.
//   2. Editing one tenant's Feature (via the real Super-Admin HTTP route,
//      including under concurrent load) never touches the other tenant's row.
//   3. Editing the master FeatureTemplate only changes what NEW tenants get
//      cloned going forward; tenants already provisioned before the edit
//      keep their original copy untouched.
//
// Every assertion here reads back through the real Express app + Prisma +
// on-disk SQLite test.db (see tests/globalSetup.ts) — no mocks.
describe("feature catalog: live two-tenant isolation", () => {
  it("provisions, edits, and re-templates across tenants with full isolation", async () => {
    const log = (...args: unknown[]) => console.log("[isolation-test]", ...args);

    // --- Super Admin session -------------------------------------------
    const { user: superAdmin } = await createSuperAdmin();
    const superCookie = await loginAs(superAdmin.email);

    // ==================================================================
    // STEP 1 — Two different tenants, same built-in feature (PRODUCTS)
    // ==================================================================
    const tenantA = await createTenantWithAdmin("Isolation Tenant A");
    const tenantB = await createTenantWithAdmin("Isolation Tenant B");
    log("Created Tenant A:", tenantA.tenant.id, "Tenant B:", tenantB.tenant.id);

    // GET the catalog for each — this is what triggers clone-on-first-access
    // (ensureBuiltIns) for a brand-new tenant, exactly as the real app does.
    const catalogA1 = await request(app).get(`/api/super-admin/feature-catalog/${tenantA.tenant.id}`).set("Cookie", superCookie);
    const catalogB1 = await request(app).get(`/api/super-admin/feature-catalog/${tenantB.tenant.id}`).set("Cookie", superCookie);
    expect(catalogA1.status).toBe(200);
    expect(catalogB1.status).toBe(200);

    const productsA = catalogA1.body.find((f: any) => f.key === "PRODUCTS");
    const productsB = catalogB1.body.find((f: any) => f.key === "PRODUCTS");
    expect(productsA).toBeTruthy();
    expect(productsB).toBeTruthy();
    log("Tenant A PRODUCTS Feature row id:", productsA.id, "label:", productsA.label);
    log("Tenant B PRODUCTS Feature row id:", productsB.id, "label:", productsB.label);

    // Same built-in, same starting content, but two structurally distinct rows.
    expect(productsA.id).not.toBe(productsB.id);
    expect(productsA.isBuiltIn).toBe(true);
    expect(productsB.isBuiltIn).toBe(true);
    expect(productsA.label).toBe("Products");
    expect(productsB.label).toBe("Products");
    expect(productsA.fields).toEqual(productsB.fields);
    expect(productsA.tenantId).toBe(tenantA.tenant.id);
    expect(productsB.tenantId).toBe(tenantB.tenant.id);

    // ==================================================================
    // STEP 2 — Editing Tenant A's feature must not affect Tenant B,
    // including when the edit and the read happen concurrently.
    // ==================================================================
    const newFieldsForA = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "price", label: "Price (₹)", type: "number", required: true },
      { key: "vipOnly", label: "VIP Exclusive", type: "checkbox" },
    ];

    const [patchRes, concurrentReadOfB] = await Promise.all([
      request(app)
        .patch(`/api/super-admin/feature-catalog/id/${productsA.id}`)
        .set("Cookie", superCookie)
        .send({ label: "A's Custom Products", fields: newFieldsForA }),
      request(app).get(`/api/super-admin/feature-catalog/${tenantB.tenant.id}`).set("Cookie", superCookie),
    ]);
    expect(patchRes.status).toBe(200);
    log("Concurrently: PATCHed Tenant A PRODUCTS ->", patchRes.body.label, "| read Tenant B catalog in-flight simultaneously");

    const productsBDuringConcurrentWrite = concurrentReadOfB.body.find((f: any) => f.key === "PRODUCTS");
    expect(productsBDuringConcurrentWrite.label).toBe("Products");
    expect(productsBDuringConcurrentWrite.fields).not.toEqual(newFieldsForA);

    // Re-fetch both after the dust settles — DB-level ground truth.
    const [afterA, afterB] = await Promise.all([
      request(app).get(`/api/super-admin/feature-catalog/${tenantA.tenant.id}`).set("Cookie", superCookie),
      request(app).get(`/api/super-admin/feature-catalog/${tenantB.tenant.id}`).set("Cookie", superCookie),
    ]);
    const productsAAfter = afterA.body.find((f: any) => f.key === "PRODUCTS");
    const productsBAfter = afterB.body.find((f: any) => f.key === "PRODUCTS");
    log("After edit — Tenant A PRODUCTS:", productsAAfter.label, JSON.stringify(productsAAfter.fields));
    log("After edit — Tenant B PRODUCTS:", productsBAfter.label, JSON.stringify(productsBAfter.fields));

    expect(productsAAfter.label).toBe("A's Custom Products");
    expect(productsAAfter.fields).toEqual(newFieldsForA);
    expect(productsBAfter.label).toBe("Products");
    expect(productsBAfter.id).toBe(productsB.id);
    expect(productsBAfter.fields).toEqual(productsB.fields);

    // Direct-DB confirmation too, bypassing the HTTP/cache layer entirely.
    const dbRowA = await prisma.feature.findUniqueOrThrow({ where: { id: productsA.id } });
    const dbRowB = await prisma.feature.findUniqueOrThrow({ where: { id: productsB.id } });
    expect(dbRowA.label).toBe("A's Custom Products");
    expect(dbRowB.label).toBe("Products");

    // ==================================================================
    // STEP 3 — Editing the master FeatureTemplate affects only tenants
    // provisioned AFTER the edit; Tenant A and B (already provisioned)
    // keep their existing PRODUCTS copy untouched.
    // ==================================================================
    const templateBefore = await prisma.featureTemplate.findUniqueOrThrow({ where: { key: "PRODUCTS" } });
    log("Master FeatureTemplate[PRODUCTS] before edit:", templateBefore.label);

    const newTemplateFields = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "price", label: "Price (₹)", type: "number", required: true },
      { key: "material", label: "Material", type: "text" },
    ];
    // Simulates a developer editing BUILT_IN_FEATURES and re-running
    // seedBuiltInFeatures — the only real way FeatureTemplate changes today
    // (see lib/featureCatalog.ts comment on ensureBuiltIns). Same upsert
    // mechanism seedBuiltInFeatures itself uses.
    await prisma.featureTemplate.update({
      where: { key: "PRODUCTS" },
      data: { label: "Products (Template v2)", fields: JSON.stringify(newTemplateFields) },
    });
    log("Master FeatureTemplate[PRODUCTS] edited -> 'Products (Template v2)'");

    // Brand-new tenant, provisioned AFTER the template edit.
    const tenantC = await createTenantWithAdmin("Isolation Tenant C (post-template-edit)");
    const catalogC = await request(app).get(`/api/super-admin/feature-catalog/${tenantC.tenant.id}`).set("Cookie", superCookie);
    const productsC = catalogC.body.find((f: any) => f.key === "PRODUCTS");
    log("Tenant C (new, provisioned after template edit) PRODUCTS:", productsC.label, JSON.stringify(productsC.fields));

    expect(productsC.label).toBe("Products (Template v2)");
    expect(productsC.fields).toEqual(newTemplateFields);

    // Tenants A and B were provisioned BEFORE the template edit — re-check
    // both are still exactly what they were, unaffected by the template change.
    const [finalA, finalB] = await Promise.all([
      request(app).get(`/api/super-admin/feature-catalog/${tenantA.tenant.id}`).set("Cookie", superCookie),
      request(app).get(`/api/super-admin/feature-catalog/${tenantB.tenant.id}`).set("Cookie", superCookie),
    ]);
    const productsAFinal = finalA.body.find((f: any) => f.key === "PRODUCTS");
    const productsBFinal = finalB.body.find((f: any) => f.key === "PRODUCTS");
    log("Post-template-edit — Tenant A PRODUCTS (pre-existing tenant):", productsAFinal.label);
    log("Post-template-edit — Tenant B PRODUCTS (pre-existing tenant):", productsBFinal.label);

    // A keeps ITS edited copy (from Step 2) — the template edit did not
    // reset or merge into it.
    expect(productsAFinal.label).toBe("A's Custom Products");
    expect(productsAFinal.fields).toEqual(newFieldsForA);
    // B keeps its original untouched copy — neither A's edit nor the
    // template edit reached it.
    expect(productsBFinal.label).toBe("Products");
    expect(productsBFinal.fields).toEqual(productsB.fields);
    expect(productsBFinal.fields).not.toEqual(newTemplateFields);

    log("RESULT: 3 tenants, 3 independent PRODUCTS rows, zero cross-contamination.");
  });
});
