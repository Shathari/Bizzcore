import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID, createHash } from "crypto";
import express from "express";
import pinoHttp from "pino-http";
import jwt from "jsonwebtoken";
import { app, createTenantWithAdmin, createSuperAdmin, loginAs, TEST_PASSWORD } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { verifyAuthToken } from "../src/lib/jwt";
import { requestLoggingOptions } from "../src/lib/requestLogging";

async function account(role: string) {
  if (role === "SUPER_ADMIN") return (await createSuperAdmin()).user;
  const { admin } = await createTenantWithAdmin();
  return prisma.user.update({ where: { id: admin.id }, data: { role } });
}
async function resetToken(userId: string) {
  const token = randomUUID();
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60000) } });
  return token;
}

describe("session and credential security", () => {
  it.each(["EMPLOYEE", "ADMIN", "SUPER_ADMIN"])("revokes old %s sessions on ordinary password change", async (role) => {
    const user = await account(role); const old = await loginAs(user.email);
    const changed = await request(app).post("/api/auth/change-password").set("Cookie", old).send({ currentPassword: TEST_PASSWORD, newPassword: "NewPassword123!" });
    expect(changed.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", old)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", changed.headers["set-cookie"])).status).toBe(200);
    const cookie = changed.headers["set-cookie"][0].split(";")[0].split("=").slice(1).join("=");
    expect(verifyAuthToken(decodeURIComponent(cookie)).authVersion).toBe(1);
  });
  it.each(["EMPLOYEE", "ADMIN", "SUPER_ADMIN"])("revokes old %s sessions on password reset", async (role) => {
    const user = await account(role); const old = await loginAs(user.email);
    const token = await resetToken(user.id);
    expect((await request(app).post("/api/auth/reset-password").send({ token, newPassword: "ResetPassword123!" })).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", old)).status).toBe(401);
    const fresh = await loginAs(user.email, "ResetPassword123!");
    expect((await request(app).get("/api/auth/me").set("Cookie", fresh)).status).toBe(200);
  });
  it("accepts legacy tokens only while the persisted version is zero", async () => {
    const user = await account("EMPLOYEE");
    const token = jwt.sign({ sub: user.id, role: "EMPLOYEE", tenantId: user.tenantId, mustChangePassword: false }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    const cookie = `bizzcore_session=${token}`;
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });
  it.each(["employee", "change", "reset"])("enforces UTF-8 password boundaries for %s", async (path) => {
    const user = await account("ADMIN"); const cookie = await loginAs(user.email);
    const submit = async (password: string) => {
      if (path === "employee") return request(app).post("/api/employees").set("Cookie", cookie).send({ name: "Staff", email: `${randomUUID()}@test.example`, temporaryPassword: password });
      if (path === "change") return request(app).post("/api/auth/change-password").set("Cookie", cookie).send({ currentPassword: TEST_PASSWORD, newPassword: password });
      return request(app).post("/api/auth/reset-password").send({ token: await resetToken(user.id), newPassword: password });
    };
    for (const password of ["short", "a".repeat(73), "é".repeat(37), "😀".repeat(19)]) expect((await submit(password)).status).toBe(400);
    expect((await submit("é".repeat(36))).status).toBe(path === "employee" ? 201 : 200);
  });
  it("redacts cookie, bearer and response-cookie credentials while keeping safe metadata", async () => {
    const logs: string[] = []; const loggingApp = express();
    loggingApp.use(pinoHttp(requestLoggingOptions, { write: (line: string) => { logs.push(line); } }));
    loggingApp.get("/safe", (_req, res) => { res.cookie("session", "response-secret"); res.json({ ok: true }); });
    expect((await request(loggingApp).get("/safe").set("Cookie", "session=cookie-secret").set("Authorization", "Bearer bearer-secret")).status).toBe(200);
    await expect.poll(() => logs.length).toBeGreaterThan(0);
    const output = logs.join("");
    for (const secret of ["cookie-secret", "bearer-secret", "response-secret"]) expect(output).not.toContain(secret);
    const entry = JSON.parse(logs[0]); expect(entry.req.method).toBe("GET"); expect(entry.req.url).toBe("/safe"); expect(entry.res.statusCode).toBe(200); expect(entry.responseTime).toBeTypeOf("number");
  });
});
