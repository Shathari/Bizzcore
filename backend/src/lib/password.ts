import crypto from "crypto";

// Excludes visually ambiguous characters (l/1/I, 0/O) so a Super Admin
// reading a temp password off-screen to someone over the phone doesn't
// introduce transcription errors.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*";

function pick(charset: string): string {
  return charset[crypto.randomInt(0, charset.length)];
}

// Guarantees at least one char from each class, then fills and shuffles —
// used for Super-Admin-provisioned temporary passwords (never stored in
// plaintext, only ever returned once in an API response or a delivery
// message).
export function generateTempPassword(length = 14): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(all));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
