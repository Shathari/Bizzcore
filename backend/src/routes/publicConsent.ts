import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicConsentRateLimiter } from "../middleware/rateLimit";
import { encryptField, maskPhone, hashForLookup, normalizePhone, phoneLookupHashes } from "../lib/piiCrypto";
import { recordConsentTransition, type ConsentStatus } from "../lib/consent";

// Public, unauthenticated — the destination of a QR code printed at a
// tenant's checkout counter (see routes/settings.ts's /consent-page
// endpoints for how the token is generated). Same trust model as
// routes/publicInquiries.ts: the token in the URL IS the permission to
// submit against that one tenant, nothing else. Unlike publicInquiries.ts,
// the token is a dedicated opaque value (Tenant.consentPageToken), not the
// tenant's own id — see schema.prisma's comment on that field for why
// (revocability).
const router = Router();

// Same not-found shape whether the token is malformed, unknown, or belongs
// to a soft-deleted tenant — nothing here should tell a caller which, same
// discipline as publicInquiries.ts's tenantId lookup.
async function resolveTenantByToken(token: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { consentPageToken: token },
    select: { id: true, businessName: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt) return null;
  return tenant;
}

// Lets the public page greet the customer by business name before they
// submit anything — deliberately the ONLY tenant data this route ever
// returns, and no customer data at all, ever (see the constraint on the
// POST handler below).
router.get("/:token", async (req, res) => {
  const tenant = await resolveTenantByToken(req.params.token);
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ businessName: tenant.businessName });
});

const submitSchema = z.object({
  phone: z.string().trim().min(6, "Enter a valid phone number"),
  choice: z.enum(["YES", "NO"], { errorMap: () => ({ message: "Choose yes or no" }) }),
});

router.post("/:token", publicConsentRateLimiter, async (req, res) => {
  const tenant = await resolveTenantByToken(req.params.token);
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { phone, choice } = parsed.data;
  const phoneHash = hashForLookup(normalizePhone(phone));

  // Look up or create WITHIN THIS TENANT ONLY — the token already scoped us
  // to one tenant above; every query/write below stays inside it.
  let customer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, phoneHash: { in: phoneLookupHashes(phone) } }, // tenant-scoped
    select: { id: true, consentStatus: true },
  });

  if (!customer) {
    // Minimal record — name left blank rather than rejecting the
    // submission, per the explicit "this is often how new customers should
    // originate" instruction. Starts at the schema default (UNKNOWN);
    // recordConsentTransition below moves it to the customer's actual
    // answer in the same request.
    customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id, // tenant-scoped
        name: "",
        phone: encryptField(phone),
        phoneMasked: maskPhone(phone),
        phoneHash,
      },
      select: { id: true, consentStatus: true },
    });
  }

  const newState: ConsentStatus = choice === "YES" ? "OPTED_IN" : "OPTED_OUT";
  await recordConsentTransition({
    tenantId: tenant.id,
    customerId: customer.id,
    previousState: customer.consentStatus as ConsentStatus,
    newState,
    source: "CUSTOMER_SELF_SERVICE",
  });

  // Confirms only what was JUST recorded in this request — never any other
  // detail about the matched/created customer, even if this phone number
  // already had an account (no name, no segment, no purchase history).
  res.json({ ok: true, status: newState });
});

export default router;
