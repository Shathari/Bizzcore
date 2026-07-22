import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../integrations/email";
import { forgotPasswordRateLimiter, resetPasswordRateLimiter } from "../middleware/rateLimit";

// Self-service "forgot password" flow — separate from routes/auth.ts's
// authenticated change-password (this one runs for a logged-out user).
// Mounted alongside auth.ts at /api/auth in app.ts.
const router = Router();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 60);

// Always the same response regardless of whether the email matched an
// account — the one thing an attacker must never be able to distinguish.
const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const forgotSchema = z.object({ email: z.string().email() });

router.post("/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(200).json({ message: GENERIC_MESSAGE });
    return;
  }
  const email = parsed.data.email.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    // A fresh request supersedes any still-outstanding link for this user.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
    });

    const resetUrl = `${FRONTEND_ORIGIN}/reset-password?token=${rawToken}`;
    const emailResult = await sendEmail({
      to: user.email,
      subject: "Reset your BizzCore password",
      text: [
        `Hi ${user.name},`,
        ``,
        `We received a request to reset your BizzCore password.`,
        ``,
        `Reset your password: ${resetUrl}`,
        ``,
        `This link expires in ${TOKEN_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email.`,
      ].join("\n"),
    });

    // Dev convenience only: mock mode means no real provider is configured
    // (inherently a local/demo environment) and no email actually went out,
    // so log the link server-side so the flow is still testable. Never
    // returned in the HTTP response — that would defeat the no-account-
    // enumeration guarantee above.
    if (emailResult.mode === "mock") {
      console.log(`[password-reset:mock] Reset link for ${user.email}: ${resetUrl}`);
    }
  }

  res.status(200).json({ message: GENERIC_MESSAGE });
});

const resetSchema = z.object({
  token: z.string().trim().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

router.post("/reset-password", resetPasswordRateLimiter, async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { token, newPassword } = parsed.data;

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustChangePassword: false },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Redeeming one link invalidates every other outstanding link for the
    // same user (e.g. if several reset emails were requested in a row).
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
  ]);

  res.json({ ok: true });
});

export default router;
