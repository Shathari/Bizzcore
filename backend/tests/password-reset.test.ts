import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app, createTenantWithAdmin, loginAs, TEST_PASSWORD } from "./helpers";
import { prisma } from "../src/lib/prisma";

function mintToken(userId: string, overrides: { expiresAt?: Date; usedAt?: Date } = {}) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return prisma.passwordResetToken
    .create({
      data: {
        userId,
        tokenHash,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        usedAt: overrides.usedAt,
      },
    })
    .then(() => rawToken);
}

describe("password reset", () => {
  it("forgot-password always returns the same generic message, whether or not the account exists", async () => {
    const { admin } = await createTenantWithAdmin();

    const known = await request(app).post("/api/auth/forgot-password").send({ email: admin.email });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@nowhere.example" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it("creates a single-use token for a known account and completes an end-to-end reset", async () => {
    const { admin } = await createTenantWithAdmin();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await request(app).post("/api/auth/forgot-password").send({ email: admin.email });

    // SMTP is unconfigured in the test env, so this runs in mock mode — the
    // route logs the reset link server-side for local-dev testability (see
    // routes/passwordReset.ts), which is what this test recovers the raw
    // token from, the same way a developer would in a real local run.
    const logged = logSpy.mock.calls
      .map((args) => args.join(" "))
      .find((line) => line.includes("[password-reset:mock]"));
    logSpy.mockRestore();
    expect(logged).toBeDefined();
    const token = logged!.match(/token=([a-f0-9]+)/)?.[1];
    expect(token).toBeTruthy();

    const record = await prisma.passwordResetToken.findFirst({ where: { userId: admin.id } });
    expect(record).not.toBeNull();
    expect(record!.usedAt).toBeNull();

    const resetRes = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "NewPass123!" });
    expect(resetRes.status).toBe(200);

    const loginRes = await request(app).post("/api/auth/login").send({ email: admin.email, password: "NewPass123!" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.mustChangePassword).toBe(false);

    const oldLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.email, password: TEST_PASSWORD });
    expect(oldLoginRes.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "NewPass123!" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const { admin } = await createTenantWithAdmin();
    const token = await mintToken(admin.id, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "NewPass123!" });
    expect(res.status).toBe(400);
  });

  it("rejects reuse of an already-used token", async () => {
    const { admin } = await createTenantWithAdmin();
    const token = await mintToken(admin.id, { usedAt: new Date() });

    const res = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "NewPass123!" });
    expect(res.status).toBe(400);
  });

  it("invalidates a user's other outstanding tokens when one is redeemed", async () => {
    const { admin } = await createTenantWithAdmin();
    const first = await mintToken(admin.id);
    const second = await mintToken(admin.id);

    const res = await request(app).post("/api/auth/reset-password").send({ token: first, newPassword: "NewPass123!" });
    expect(res.status).toBe(200);

    const secondAttempt = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: second, newPassword: "AnotherPass123!" });
    expect(secondAttempt.status).toBe(400);
  });
});
