import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, TEST_PASSWORD } from "./helpers";

describe("rbac: role and authentication boundaries", () => {
  it("blocks a regular ADMIN from Super Admin routes with 403", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app).get("/api/super-admin/businesses").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("blocks SUPER_ADMIN from tenant business-data routes with 403 (no tenant context)", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/customers").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("allows SUPER_ADMIN to reach Super Admin routes", async () => {
    const { user } = await createSuperAdmin();
    const cookie = await loginAs(user.email);
    const res = await request(app).get("/api/super-admin/businesses").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects requests with no session cookie with 401", async () => {
    const res = await request(app).get("/api/customers");
    expect(res.status).toBe(401);
  });

  it("rejects requests with a garbage session cookie with 401", async () => {
    const res = await request(app).get("/api/customers").set("Cookie", "bizzcore_session=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("ADMIN login never carries a null tenantId", async () => {
    const { admin } = await createTenantWithAdmin();
    const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: TEST_PASSWORD });
    expect(res.body.tenantId).not.toBeNull();
  });
});
