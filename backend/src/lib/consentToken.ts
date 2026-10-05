import crypto from "crypto";

// 18 random bytes -> 24-char base64url string — short enough to fit
// comfortably in a printed QR code and URL, long enough (144 bits) that
// guessing one is not a realistic attack, same order of magnitude as this
// app's other opaque tokens (see lib/jwt.ts, PasswordResetToken).
export function generateConsentToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}
