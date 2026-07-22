import crypto from "crypto";
import { encrypt, decrypt } from "./crypto";

// Reusable helpers for any Customer-style PII field (phone, birthday today;
// address, ID numbers, etc. later) that must be encrypted at rest and never
// rendered in plaintext to any screen. Built directly on top of crypto.ts's
// AES-256-GCM encrypt/decrypt — the same utility and the same
// CREDENTIAL_ENCRYPTION_KEY already used for IntegrationCredential.encryptedPayload,
// so there is exactly one algorithm and one key to rotate for everything
// this app treats as sensitive.

export const encryptField = encrypt;
export const decryptField = decrypt;

function getLookupKey(): Buffer {
  const hex = process.env.PII_LOOKUP_HASH_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("PII_LOOKUP_HASH_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

// Deterministic, non-reversible lookup token (HMAC-SHA256 under its own key
// — never the encryption key, so a lookup-hash leak can't help decrypt
// anything). Lets the app do exact-match lookups (import de-dup, "does this
// phone already exist for this tenant") and indexed queries without ever
// decrypting stored rows or exposing plaintext. Caller must normalize input
// first (e.g. strip formatting from a phone number) so the same logical
// value always hashes the same way.
export function hashForLookup(normalized: string): string {
  return crypto.createHmac("sha256", getLookupKey()).update(normalized).digest("hex");
}

// Partial mask safe to return in API responses/UI as a confirm-hint (e.g.
// "+9198••••••75"). One-way — built directly from plaintext at write time,
// never derived by decrypting stored ciphertext for display.
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length <= 6) return "•".repeat(digits.length);
  const head = digits.slice(0, 5);
  const tail = digits.slice(-2);
  const maskedLen = Math.max(digits.length - head.length - tail.length, 4);
  return `${head}${"•".repeat(maskedLen)}${tail}`;
}

// Plaintext, low-sensitivity derivative of a birthday (month + day, no
// year) that lets a "birthday today / this month" automation query match
// candidates without decrypting every customer row. The automation then
// JIT-decrypts the full birthday only for rows that already matched, right
// before it's used, and discards it — see AccessLog note in the migration
// plan.
export function monthDayOf(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}
