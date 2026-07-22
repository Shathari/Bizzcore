import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, TEST_PASSWORD, createTestCustomer } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { getFeatureByKey } from "../src/lib/featureCatalog";

// Business Management console (routes/super-admin.ts): full tenant edit,
// soft/permanent delete + restore, and the resulting immediate-effect
// enforcement in middleware/resolveTenant.ts and routes/auth.ts. Suspend/
// Activate and Regenerate-credentials already had coverage baked into the
// wider RBAC/auth suites before this feature — this file covers what's net
// new here.
describe("super-admin business management", () => {
  it("blocks a regular ADMIN with 403 on every new route", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const patch = await request(app).patch(`/api/super-admin/businesses/${tenant.id}`).set("Cookie", cookie).send({ businessName: "Nope" });
    expect(patch.status).toBe(403);

    const del = await request(app).delete(`/api/super-admin/businesses/${tenant.id}`).set("Cookie", cookie).send({ confirmName: "DELETE" });
    expect(del.status).toBe(403);

    const restore = await request(app).post(`/api/super-admin/businesses/${tenant.id}/restore`).set("Cookie", cookie);
    expect(restore.status).toBe(403);
  });

  it("updates business + owner fields, keeping Tenant.ownerEmail and the admin User.email in sync", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const newEmail = `updated-${admin.email}`;
    const res = await request(app)
      .patch(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({
        businessName: "Renamed Boutique",
        websiteUrl: "https://renamed.example.com",
        customDomain: "shop.renamed.example.com",
        address: "221B Baker Street",
        ownerName: "New Owner Name",
        ownerEmail: newEmail,
        ownerPhone: "+919876543210",
      });
    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe("Renamed Boutique");
    expect(res.body.websiteUrl).toBe("https://renamed.example.com");
    expect(res.body.customDomain).toBe("shop.renamed.example.com");
    expect(res.body.address).toBe("221B Baker Street");
    expect(res.body.ownerEmail).toBe(newEmail.toLowerCase());
    expect(res.body.ownerPhone).toBe("+919876543210");

    const updatedAdmin = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(updatedAdmin?.name).toBe("New Owner Name");
    expect(updatedAdmin?.email).toBe(newEmail.toLowerCase());
    expect(updatedAdmin?.phone).toBe("+919876543210");

    // The new email must actually work as a login, proving this isn't just
    // a cosmetic Tenant-column update.
    const loginRes = await request(app).post("/api/auth/login").send({ email: newEmail, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
  });

  it("rejects an owner-email change that collides with a different tenant's user", async () => {
    const { admin: otherAdmin } = await createTenantWithAdmin("Other Boutique");
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const res = await request(app)
      .patch(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ ownerEmail: otherAdmin.email });
    expect(res.status).toBe(409);
  });

  it("rejects a custom domain already claimed by another tenant", async () => {
    const { tenant: tenantA } = await createTenantWithAdmin();
    const { tenant: tenantB } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const claim = await request(app)
      .patch(`/api/super-admin/businesses/${tenantA.id}`)
      .set("Cookie", cookie)
      .send({ customDomain: "shared-domain.example.com" });
    expect(claim.status).toBe(200);

    const collide = await request(app)
      .patch(`/api/super-admin/businesses/${tenantB.id}`)
      .set("Cookie", cookie)
      .send({ customDomain: "shared-domain.example.com" });
    expect(collide.status).toBe(409);
  });

  it("logs BUSINESS_UPDATED with a before/after diff", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    await request(app).patch(`/api/super-admin/businesses/${tenant.id}`).set("Cookie", cookie).send({ businessName: "Diff Test Boutique" });

    const entry = await prisma.auditLog.findFirst({ where: { targetTenantId: tenant.id, action: "BUSINESS_UPDATED" } });
    expect(entry).not.toBeNull();
    const details = JSON.parse(entry!.details!);
    expect(details.before.businessName).toBe(tenant.businessName);
    expect(details.after.businessName).toBe("Diff Test Boutique");
  });

  it("rejects a delete request with the wrong confirmation text and performs no mutation", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const res = await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ confirmName: "not the business name" });
    expect(res.status).toBe(400);

    const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("accepts the literal 'DELETE' as well as the exact business name", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const res = await request(app).delete(`/api/super-admin/businesses/${tenant.id}`).set("Cookie", cookie).send({ confirmName: "DELETE" });
    expect(res.status).toBe(204);

    const stored = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(stored?.deletedAt).not.toBeNull();
  });

  it("soft delete hides the tenant from the default list, blocks login, and restore reverses both", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const del = await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ confirmName: tenant.businessName });
    expect(del.status).toBe(204);

    const listDefault = await request(app).get("/api/super-admin/businesses").set("Cookie", cookie);
    expect(listDefault.body.find((b: { id: string }) => b.id === tenant.id)).toBeUndefined();

    const listIncluded = await request(app).get("/api/super-admin/businesses?includeDeleted=true").set("Cookie", cookie);
    const found = listIncluded.body.find((b: { id: string }) => b.id === tenant.id);
    expect(found).toBeDefined();
    expect(found.deletedAt).not.toBeNull();

    const loginRes = await request(app).post("/api/auth/login").send({ email: admin.email, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(401);

    const secondDelete = await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ confirmName: tenant.businessName });
    expect(secondDelete.status).toBe(409);

    const restore = await request(app).post(`/api/super-admin/businesses/${tenant.id}/restore`).set("Cookie", cookie);
    expect(restore.status).toBe(200);
    expect(restore.body.deletedAt).toBeNull();

    const listAfterRestore = await request(app).get("/api/super-admin/businesses").set("Cookie", cookie);
    expect(listAfterRestore.body.find((b: { id: string }) => b.id === tenant.id)).toBeDefined();

    const loginAfterRestore = await request(app).post("/api/auth/login").send({ email: admin.email, password: TEST_PASSWORD });
    expect(loginAfterRestore.status).toBe(200);
  });

  it("resolveTenant blocks an already-logged-in session immediately after soft delete (not just at next login)", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const superCookie = await loginAs(user.email);
    const adminCookie = await loginAs(admin.email);

    // Session obtained before the delete — proves enforcement isn't only
    // at login (JWTs are stateless; see middleware/resolveTenant.ts).
    const before = await request(app).get("/api/dashboard/summary").set("Cookie", adminCookie);
    expect(before.status).toBe(200);

    await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", superCookie)
      .send({ confirmName: "DELETE" });

    const after = await request(app).get("/api/dashboard/summary").set("Cookie", adminCookie);
    expect(after.status).toBe(403);
  });

  it("resolveTenant blocks an already-logged-in session immediately after suspend", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const superCookie = await loginAs(user.email);
    const adminCookie = await loginAs(admin.email);

    await request(app).patch(`/api/super-admin/businesses/${tenant.id}/status`).set("Cookie", superCookie).send({ status: "Suspended" });

    const after = await request(app).get("/api/dashboard/summary").set("Cookie", adminCookie);
    expect(after.status).toBe(403);
  });

  it("permanently deletes a tenant and every related record inside one operation, detaching (not deleting) its audit history", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const feature = await getFeatureByKey(tenant.id, "PRODUCTS");
    if (!feature) throw new Error("expected a PRODUCTS feature to be cloned for this tenant");
    const integration = await prisma.websiteIntegration.create({
      data: { tenantId: tenant.id, featureId: feature.id, baseUrl: "https://example.com/api/products", active: true },
    });
    await prisma.websiteContentItem.create({
      data: { tenantId: tenant.id, featureId: feature.id, payload: JSON.stringify({ name: "Test Product" }), syncStatus: "synced" },
    });
    await createTestCustomer(tenant.id, { name: "Priya", phone: "+919800000000" });

    // A pre-existing audit row that targets this tenant — must survive
    // permanent delete with targetTenantId nulled, not be deleted itself
    // (see schema.prisma's AuditLog.targetTenant onDelete: SetNull).
    const preExistingAudit = await prisma.auditLog.create({
      data: { actorId: user.id, action: "BUSINESS_CREATED", targetTenantId: tenant.id, details: JSON.stringify({ businessName: tenant.businessName }) },
    });

    const res = await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ confirmName: tenant.businessName, permanent: true });
    expect(res.status).toBe(204);

    expect(await prisma.tenant.findUnique({ where: { id: tenant.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).toBeNull();
    expect(await prisma.websiteIntegration.findUnique({ where: { id: integration.id } })).toBeNull();
    expect(await prisma.customer.findMany({ where: { tenantId: tenant.id } })).toHaveLength(0);
    expect(await prisma.websiteContentItem.findMany({ where: { tenantId: tenant.id } })).toHaveLength(0);

    // Feature is this tenant's own independent row (tenant-scoped, see
    // prisma/scripts/tenant-scope-features.ts) -- it cascades away with the
    // tenant, same as its other tenant-owned data, not "shared and
    // untouched" the way the old global catalog would have been.
    expect(await prisma.feature.findUnique({ where: { id: feature.id } })).toBeNull();

    // Audit history survives, detached rather than deleted.
    const survivingAudit = await prisma.auditLog.findUnique({ where: { id: preExistingAudit.id } });
    expect(survivingAudit).not.toBeNull();
    expect(survivingAudit?.targetTenantId).toBeNull();

    // The permanent-delete action itself is logged with a snapshot, since
    // the tenant row is gone by the time it's written.
    const deletionLog = await prisma.auditLog.findFirst({ where: { action: "BUSINESS_PERMANENTLY_DELETED", actorId: user.id } });
    expect(deletionLog).not.toBeNull();
    expect(deletionLog?.targetTenantId).toBeNull();
    expect(JSON.parse(deletionLog!.details!).businessName).toBe(tenant.businessName);
  });

  it("permanent delete works even when the tenant was already soft-deleted", async () => {
    const { tenant } = await createTenantWithAdmin();
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    await request(app).delete(`/api/super-admin/businesses/${tenant.id}`).set("Cookie", cookie).send({ confirmName: "DELETE" });

    const res = await request(app)
      .delete(`/api/super-admin/businesses/${tenant.id}`)
      .set("Cookie", cookie)
      .send({ confirmName: "DELETE", permanent: true });
    expect(res.status).toBe(204);
    expect(await prisma.tenant.findUnique({ where: { id: tenant.id } })).toBeNull();
  });

  it("returns 404 permanently-deleting or restoring an unknown tenant id", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);

    const del = await request(app).delete("/api/super-admin/businesses/no-such-tenant").set("Cookie", cookie).send({ confirmName: "DELETE" });
    expect(del.status).toBe(404);

    const restore = await request(app).post("/api/super-admin/businesses/no-such-tenant/restore").set("Cookie", cookie);
    expect(restore.status).toBe(404);
  });
});
