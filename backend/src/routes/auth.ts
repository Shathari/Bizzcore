import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signAuthToken } from "../lib/jwt";
import { authenticate } from "../middleware/auth";
import { loginRateLimiter } from "../middleware/rateLimit";
import type { Role } from "../lib/roles";

// Auth surface: login/logout/me plus change-password for the forced
// "set new password" flow. Role-based redirect and the forced-password-
// change screen live in the frontend (see AuthContext / RequireAuth) —
// this route file is what they call.

const router = Router();
const COOKIE_NAME = process.env.COOKIE_NAME ?? "bizzcore_session";
const isProduction = process.env.NODE_ENV === "production";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format" });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { tenant: true },
  });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Generic "invalid credentials" rather than a distinct "deleted" message —
  // unlike Suspended (a recoverable state a legitimate admin should be told
  // to contact support about), a deleted business shouldn't confirm to an
  // unauthenticated caller that it ever existed.
  if (user.role === "ADMIN" && user.tenant?.deletedAt) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.role === "ADMIN" && user.tenant?.status === "Suspended") {
    res.status(403).json({ error: "This account has been suspended. Contact support." });
    return;
  }

  const token = signAuthToken({
    sub: user.id,
    role: user.role as Role,
    tenantId: user.tenantId,
    mustChangePassword: user.mustChangePassword,
  });

  res.cookie(COOKIE_NAME, token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: "none",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    role: user.role,
    tenantId: user.tenantId,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tenantId: true,
      mustChangePassword: true,
      tenant: { select: { businessName: true, logoUrl: true } },
    },
  });
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { tenant, ...rest } = user;
  res.json({ ...rest, businessName: tenant?.businessName ?? null, logoUrl: tenant?.logoUrl ?? null });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

router.post("/change-password", authenticate, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  // Reissue the session cookie so mustChangePassword: false takes effect
  // immediately, without forcing a second login.
  const token = signAuthToken({
    sub: user.id,
    role: user.role as Role,
    tenantId: user.tenantId,
    mustChangePassword: false,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ ok: true });
});

export default router;
