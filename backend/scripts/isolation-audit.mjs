// Live, two-tenant concurrent isolation audit — hits the real Express app
// over real HTTP (supertest), not just direct Prisma calls, because a
// cross-tenant leak in this codebase would most likely come from the
// request layer (wrong req.tenantId propagation, a module-level cache
// keyed wrong, a closure capturing the wrong tenant) rather than from the
// database's own WHERE-clause scoping, which is already covered by
// tests/tenant-isolation.test.ts and tests/feature-catalog-tenant-isolation.test.ts.
//
// Covers Feature (via the Super-Admin Feature Catalog PATCH route) and
// WebsiteContentItem (via the Business-Admin website-content PATCH route)
// specifically, with FOUR requests fired in a single Promise.all — genuinely
// overlapping from the caller's perspective, not sequential awaits.
//
// Caveat, stated plainly: this repo's dev/test datastore is SQLite, which
// serializes actual disk writes behind a single-writer file lock (see
// vitest.config.ts's own comment on this). That means this audit proves
// tenant isolation holds under concurrent REQUEST-level execution — shared
// caches, req.tenantId propagation, route-handler closures — which is where
// this codebase's isolation actually lives (WHERE tenantId = ? scoping
// throughout). It does NOT (and structurally cannot, against SQLite) prove
// storage-engine multi-connection write-race safety — that's a Postgres-only
// question and would need re-verification there before a production launch
// if it hasn't been already.
//
// Run: npx tsx scripts/isolation-audit.mjs  (from backend/, against dev.db)

import { config } from "dotenv";
config({ path: "./.env" });
process.env.NODE_ENV = "test"; // quiets pino-http's own request/response logging so the audit's own log lines aren't buried
import request from "supertest";
import bcrypt from "bcryptjs";

const { createApp } = await import("../src/app.ts");
const { prisma } = await import("../src/lib/prisma.ts");

const app = createApp();
const startedAt = Date.now();
function log(...args) {
  console.log(`[+${String(Date.now() - startedAt).padStart(5, " ")}ms]`, ...args);
}

const PASSWORD = "TestPass123!";
const suffix = Date.now();

async function createTenantWithAdmin(label) {
  const tenant = await prisma.tenant.create({
    data: { businessName: `Isolation Audit ${label} ${suffix}`, ownerEmail: `${label.toLowerCase()}-${suffix}@test.local`, status: "Active" },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.create({
    data: { tenantId: tenant.id, name: `Isolation Audit ${label} Admin`, email: `${label.toLowerCase()}-admin-${suffix}@test.local`, passwordHash, role: "ADMIN", mustChangePassword: false },
  });
  const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { planId: plan.id } });
  return { tenant, admin };
}

async function loginAs(email) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  const cookie = res.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return cookie.split(";")[0];
}

async function main() {
  log("=== Setup ===");
  const { tenant: tenantA, admin: adminA } = await createTenantWithAdmin("A");
  const { tenant: tenantB, admin: adminB } = await createTenantWithAdmin("B");
  const { user: superAdmin } = await (async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await prisma.user.create({
      data: { tenantId: null, name: "Isolation Audit Super Admin", email: `super-${suffix}@test.local`, passwordHash, role: "SUPER_ADMIN", mustChangePassword: false },
    });
    return { user };
  })();
  log("Tenant A:", tenantA.id, "| Tenant B:", tenantB.id);

  const cookieA = await loginAs(adminA.email);
  const cookieB = await loginAs(adminB.email);
  const superCookie = await loginAs(superAdmin.email);

  // Clone-on-first-access the PRODUCTS built-in for both tenants (same
  // mechanism the real app uses — see lib/featureCatalog.ts's ensureBuiltIns).
  const catalogA = await request(app).get(`/api/super-admin/feature-catalog/${tenantA.id}`).set("Cookie", superCookie);
  const catalogB = await request(app).get(`/api/super-admin/feature-catalog/${tenantB.id}`).set("Cookie", superCookie);
  const featureA = catalogA.body.find((f) => f.key === "PRODUCTS");
  const featureB = catalogB.body.find((f) => f.key === "PRODUCTS");
  log("Feature A id:", featureA.id, "| Feature B id:", featureB.id);

  // Configure a connector for each tenant so PATCH /api/website-content works.
  await request(app).put("/api/connector-config/PRODUCTS").set("Cookie", cookieA).send({ baseUrl: "https://example.com/api/products", authType: "none" });
  await request(app).put("/api/connector-config/PRODUCTS").set("Cookie", cookieB).send({ baseUrl: "https://example.com/api/products", authType: "none" });

  const itemA = await prisma.websiteContentItem.create({
    data: { tenantId: tenantA.id, featureId: featureA.id, payload: JSON.stringify({ name: "A's Original Product" }), syncStatus: "synced" },
  });
  const itemB = await prisma.websiteContentItem.create({
    data: { tenantId: tenantB.id, featureId: featureB.id, payload: JSON.stringify({ name: "B's Original Product" }), syncStatus: "synced" },
  });
  log("Item A id:", itemA.id, "| Item B id:", itemB.id);

  log("\n=== Firing 4 genuinely concurrent requests (single Promise.all) ===");
  log("  1) PATCH Feature A's schema (Super Admin)");
  log("  2) PATCH Feature B's schema (Super Admin)");
  log("  3) PATCH Item A's data (Tenant A Admin)");
  log("  4) PATCH Item B's data (Tenant B Admin)");

  const [featurePatchA, featurePatchB, itemPatchA, itemPatchB] = await Promise.all([
    request(app)
      .patch(`/api/super-admin/feature-catalog/id/${featureA.id}`)
      .set("Cookie", superCookie)
      .send({ label: "A's Concurrently-Edited Label", fields: [{ key: "name", label: "Name", type: "text", required: true }] })
      .then((r) => {
        log("  <- Feature A PATCH resolved:", r.status);
        return r;
      }),
    request(app)
      .patch(`/api/super-admin/feature-catalog/id/${featureB.id}`)
      .set("Cookie", superCookie)
      .send({ label: "B's Concurrently-Edited Label", fields: [{ key: "name", label: "Name", type: "text", required: true }] })
      .then((r) => {
        log("  <- Feature B PATCH resolved:", r.status);
        return r;
      }),
    request(app)
      .patch(`/api/website-content/PRODUCTS/${itemA.id}`)
      .set("Cookie", cookieA)
      .send({ name: "A's Concurrently-Edited Product" })
      .then((r) => {
        log("  <- Item A PATCH resolved:", r.status);
        return r;
      }),
    request(app)
      .patch(`/api/website-content/PRODUCTS/${itemB.id}`)
      .set("Cookie", cookieB)
      .send({ name: "B's Concurrently-Edited Product" })
      .then((r) => {
        log("  <- Item B PATCH resolved:", r.status);
        return r;
      }),
  ]);

  log("\n=== Cross-check: each tenant's write must never bleed into the other's ===");
  const checks = [];

  checks.push(["Feature A PATCH response has A's own label", featurePatchA.body.label === "A's Concurrently-Edited Label"]);
  checks.push(["Feature B PATCH response has B's own label", featurePatchB.body.label === "B's Concurrently-Edited Label"]);
  // baseUrl points at example.com (not a real API), so the outbound JSON
  // push itself may legitimately fail (502) — that's unrelated to
  // isolation. What matters here is that even the RESPONSE BODY never
  // leaks the other tenant's data, in either the 200 or 502 shape (see
  // routes/websiteContent.ts: a 502 still returns { item } with this
  // tenant's own item).
  const itemBodyA = itemPatchA.status === 200 ? itemPatchA.body : itemPatchA.body.item;
  const itemBodyB = itemPatchB.status === 200 ? itemPatchB.body : itemPatchB.body.item;
  checks.push(["Item A PATCH got a definite response (200 or 502)", [200, 502].includes(itemPatchA.status)]);
  checks.push(["Item B PATCH got a definite response (200 or 502)", [200, 502].includes(itemPatchB.status)]);
  checks.push(["Item A PATCH response reflects A's own data, not B's", itemBodyA?.payload?.name === "A's Concurrently-Edited Product"]);
  checks.push(["Item B PATCH response reflects B's own data, not A's", itemBodyB?.payload?.name === "B's Concurrently-Edited Product"]);

  // Re-read fresh from the DB — the ground truth, independent of what each
  // response claimed.
  const finalFeatureA = await prisma.feature.findUniqueOrThrow({ where: { id: featureA.id } });
  const finalFeatureB = await prisma.feature.findUniqueOrThrow({ where: { id: featureB.id } });
  const finalItemA = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: itemA.id } });
  const finalItemB = await prisma.websiteContentItem.findUniqueOrThrow({ where: { id: itemB.id } });

  log("Final Feature A:", finalFeatureA.label, "| tenantId:", finalFeatureA.tenantId);
  log("Final Feature B:", finalFeatureB.label, "| tenantId:", finalFeatureB.tenantId);
  log("Final Item A:", finalItemA.payload, "| tenantId:", finalItemA.tenantId);
  log("Final Item B:", finalItemB.payload, "| tenantId:", finalItemB.tenantId);

  checks.push(["DB: Feature A kept A's label, not B's", finalFeatureA.label === "A's Concurrently-Edited Label"]);
  checks.push(["DB: Feature B kept B's label, not A's", finalFeatureB.label === "B's Concurrently-Edited Label"]);
  checks.push(["DB: Feature A tenantId still A", finalFeatureA.tenantId === tenantA.id]);
  checks.push(["DB: Feature B tenantId still B", finalFeatureB.tenantId === tenantB.id]);
  checks.push(["DB: Item A got A's edit, not B's", JSON.parse(finalItemA.payload).name === "A's Concurrently-Edited Product"]);
  checks.push(["DB: Item B got B's edit, not A's", JSON.parse(finalItemB.payload).name === "B's Concurrently-Edited Product"]);
  checks.push(["DB: Item A tenantId still A", finalItemA.tenantId === tenantA.id]);
  checks.push(["DB: Item B tenantId still B", finalItemB.tenantId === tenantB.id]);

  // Read-scoping under the same load: neither tenant's catalog/list view
  // should ever surface the other's rows.
  const listA = await request(app).get(`/api/super-admin/feature-catalog/${tenantA.id}`).set("Cookie", superCookie);
  const listB = await request(app).get(`/api/super-admin/feature-catalog/${tenantB.id}`).set("Cookie", superCookie);
  checks.push(["Tenant A's feature list excludes B's feature row", listA.body.every((f) => f.id !== featureB.id)]);
  checks.push(["Tenant B's feature list excludes A's feature row", listB.body.every((f) => f.id !== featureA.id)]);

  const itemsA = await request(app).get("/api/website-content/PRODUCTS").set("Cookie", cookieA);
  const itemsB = await request(app).get("/api/website-content/PRODUCTS").set("Cookie", cookieB);
  checks.push(["Tenant A's item list excludes B's item", itemsA.body.items.every((i) => i.id !== itemB.id)]);
  checks.push(["Tenant B's item list excludes A's item", itemsB.body.items.every((i) => i.id !== itemA.id)]);
  checks.push(["Tenant A cannot fetch B's item by id (404, not the data)", (await request(app).patch(`/api/website-content/PRODUCTS/${itemB.id}`).set("Cookie", cookieA).send({ name: "hijacked" })).status === 404]);
  checks.push(["Tenant B cannot fetch A's item by id (404, not the data)", (await request(app).patch(`/api/website-content/PRODUCTS/${itemA.id}`).set("Cookie", cookieB).send({ name: "hijacked" })).status === 404]);

  log("\n=== Results ===");
  let allPassed = true;
  for (const [desc, passed] of checks) {
    log(passed ? "PASS" : "FAIL", "-", desc);
    if (!passed) allPassed = false;
  }

  log("\n=== Cleanup ===");
  await prisma.websiteContentItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.websiteIntegration.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.feature.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA.id, adminB.id, superAdmin.id] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  log("Cleanup complete");

  if (!allPassed) {
    console.error("\nISOLATION AUDIT FAILED — see FAIL lines above");
    process.exitCode = 1;
    return;
  }
  console.log(`\nISOLATION AUDIT PASSED (${checks.length}/${checks.length}) — zero cross-tenant leakage in Feature or WebsiteContentItem under genuinely concurrent, interleaved requests.`);
}

main()
  .catch((err) => {
    console.error("ISOLATION AUDIT ERRORED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
