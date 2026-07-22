import rateLimit from "express-rate-limit";

// Keyed on IP + email together, so an attacker can't dodge the limit either
// by spraying different emails from one IP, or hammering one email from
// many IPs.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
    return `${req.ip ?? "unknown"}:${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many login attempts. Try again later." });
  },
});

// Same IP+email keying as loginRateLimiter — limits both request-flooding a
// single email with reset links and enumeration attempts from one IP.
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
    return `${req.ip ?? "unknown"}:${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests. Try again later." });
  },
});

// Reset tokens are high-entropy (32 random bytes), so brute-forcing one is
// impractical regardless — this limiter just caps request volume per IP.
export const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests. Try again later." });
  },
});

// Caps how many Customer PII decryptions (reveal / call) one Admin can
// trigger per minute — each one is legitimate individually, but without a
// cap an Admin account (or a hijacked session) could walk the full customer
// list one reveal at a time and reconstruct a bulk export. Keyed on the
// authenticated user, not IP, since this always runs after `authenticate`.
export const revealRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown",
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many reveal requests. Please wait a minute and try again." });
  },
});

// A confirmed contact-info export JIT-decrypts every customer's phone/
// birthday in one call — strictly more sensitive than a single reveal, so
// this is capped much tighter than revealRateLimiter (a handful of exports
// per hour is a realistic ceiling for legitimate use; anything faster than
// that is someone trying to walk the full customer list via repeated
// exports rather than the one-at-a-time reveal path).
export const bulkExportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown",
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many contact-info exports. Please wait before trying again." });
  },
});

// Caps how often WE hit a given tenant's external site — test/discover-
// schema/sync/import all make real outbound calls to whatever a tenant
// configured as their connector, so this is keyed on tenantId (not the
// acting Super Admin) so it limits per-target-site request volume
// regardless of who's triggering it. Protects the tenant's own site from
// being hammered by a compromised admin session or a malfunctioning
// client, same rationale as revealRateLimiter but for outbound traffic
// instead of PII decryption.
export const connectorRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // req.params.tenantId on Super Admin's cross-tenant routes; req.tenantId
  // (set by resolveTenant from the JWT) on the Business Admin router.
  keyGenerator: (req) => req.params.tenantId ?? req.tenantId ?? req.ip ?? "unknown",
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many connector requests for this business. Please wait a minute and try again." });
  },
});
