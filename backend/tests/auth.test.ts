import { describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app, createTenantWithAdmin, loginAs, TEST_PASSWORD } from "./helpers";
import { prisma } from "../src/lib/prisma";

describe("auth: login", () => {
  it("succeeds with correct credentials and returns role/tenantId", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "ADMIN", tenantId: tenant.id, mustChangePassword: false });
    expect(res.headers["set-cookie"]?.[0]).toContain("HttpOnly");
  });

  it("rejects a wrong password with 401", async () => {
    const { admin } = await createTenantWithAdmin();
    const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects a nonexistent email with 401 (same error as wrong password)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "nobody@test.example", password: "x" });
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed attempts for the same email", async () => {
    const { admin } = await createTenantWithAdmin();
    let lastStatus = 0;
    for (let i = 0; i < 9; i++) {
      const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: "wrong" });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("blocks login for a suspended tenant's admin", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "Suspended" } });

    const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("GET /me returns the authenticated user including businessName", async () => {
    const { tenant, admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);

    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: admin.email, role: "ADMIN", businessName: tenant.businessName });
  });

  it("rejects unauthenticated requests to /me with 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("auth: forced password change", () => {
  it("blocks tenant business routes until the password is changed, then unblocks", async () => {
    const { tenant } = await createTenantWithAdmin();
    const passwordHash = await bcrypt.hash("TempPass123!", 10);
    const admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Fresh Admin",
        email: "fresh-admin@test.example",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: true,
      },
    });

    const loginRes = await request(app).post("/api/auth/login").send({ email: admin.email, password: "TempPass123!" });
    expect(loginRes.body.mustChangePassword).toBe(true);
    const cookie = loginRes.headers["set-cookie"][0].split(";")[0];

    const blockedRes = await request(app).get("/api/customers").set("Cookie", cookie);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.code).toBe("MUST_CHANGE_PASSWORD");

    // /me must still work while forced — the frontend needs it to decide
    // where to redirect.
    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);

    const changeRes = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "TempPass123!", newPassword: "NewSecurePass456!" });
    expect(changeRes.status).toBe(200);

    const newCookie = changeRes.headers["set-cookie"][0].split(";")[0];
    const unblockedRes = await request(app).get("/api/customers").set("Cookie", newCookie);
    expect(unblockedRes.status).toBe(200);
  });

  it("rejects change-password with the wrong current password", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "wrong", newPassword: "NewSecurePass456!" });
    expect(res.status).toBe(401);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const { admin } = await createTenantWithAdmin();
    const cookie = await loginAs(admin.email);
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "short" });
    expect(res.status).toBe(400);
  });
});
