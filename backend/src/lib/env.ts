// Fail loudly and immediately at boot if any variable this app cannot run
// safely without is missing or malformed — the alternative (each consumer
// checking lazily on first use, e.g. crypto.ts's getKey()/jwt.ts's
// getSecret()) means the server reports "successfully started" and only
// breaks on the first real request that happens to need it, in production,
// in front of a customer.
//
// Deliberately does NOT include optional, feature-gated integrations
// (OPENAI_API_KEY, RAZORPAY_*, WHATSAPP_*, META_*) — those already fail
// gracefully per-feature by design (see e.g. integrations/razorpay.ts's own
// comment on why it has no mock mode) and requiring them here would break
// every environment that legitimately hasn't set them up yet, including
// local dev.
const HEX64 = /^[0-9a-f]{64}$/i;

type Check = { name: string; validate: (value: string) => string | null }; // null = valid

const REQUIRED: Check[] = [
  { name: "DATABASE_URL", validate: () => null },
  { name: "JWT_SECRET", validate: () => null },
  {
    name: "CREDENTIAL_ENCRYPTION_KEY",
    validate: (v) => (HEX64.test(v) ? null : "must be a 64-character hex string (32 bytes) — see lib/crypto.ts"),
  },
  {
    name: "PII_LOOKUP_HASH_KEY",
    validate: (v) => (HEX64.test(v) ? null : "must be a 64-character hex string (32 bytes) — see lib/piiCrypto.ts"),
  },
  // Object storage (lib/objectStorage.ts) — unlike the other optional
  // integrations, uploads have no fallback mode at all now that local disk
  // is gone (see lib/upload.ts), so a missing R2 var means every upload
  // route is broken, not gracefully degraded. Required here for the same
  // reason as the encryption keys above.
  { name: "R2_ACCOUNT_ID", validate: () => null },
  { name: "R2_ACCESS_KEY_ID", validate: () => null },
  { name: "R2_SECRET_ACCESS_KEY", validate: () => null },
  { name: "R2_BUCKET_NAME", validate: () => null },
  { name: "R2_PUBLIC_URL", validate: () => null },
];

export function validateEnv(): void {
  const errors: string[] = [];
  for (const { name, validate } of REQUIRED) {
    const value = process.env[name];
    if (!value) {
      errors.push(`${name} is not set`);
      continue;
    }
    const error = validate(value);
    if (error) errors.push(`${name} ${error}`);
  }
  if (errors.length > 0) {
    console.error("Refusing to start: invalid environment configuration.");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
