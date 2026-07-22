import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { requirePasswordSet } from "../middleware/requirePasswordSet";
import { generateTempPassword } from "../lib/password";
import { sendEmail } from "../integrations/email";
import { sendSms, type SmsResult } from "../integrations/sms";
import { createMemoryUploader, saveBufferForTenant, deleteUploadedFile, handleUpload, UPLOADS_ROOT } from "../lib/upload";

// Super Admin manages account status/credentials, not tenant business data
// (keeps a clean audit trail — see spec). Every route here intentionally
// operates *across* tenants by tenant id from the URL/body, not from
// req.tenantId (Super Admin JWTs carry no tenantId at all). This is the
// deliberate exception to the "// tenant-scoped" convention used elsewhere:
// these queries are marked "// cross-tenant: super-admin" instead, so an
// auditor doesn't mistake the absence of req.tenantId filtering for a bug.
const router = Router();
router.use(authenticate, requirePasswordSet, authorize("SUPER_ADMIN"));

const APP_LOGIN_URL = process.env.APP_LOGIN_URL ?? "http://localhost:5173/login";
const logoUpload = createMemoryUploader();

async function logAudit(
  actorId: string,
  action: string,
  targetTenantId: string | null,
  details?: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: { actorId, action, targetTenantId, details: details ? JSON.stringify(details) : null },
  });
}

async function deliverCredentials(
  tenant: { businessName: string },
  user: { name: string; email: string; phone: string | null },
  tempPassword: string
) {
  const emailResult = await sendEmail({
    to: user.email,
    subject: `Your BizzCore login for ${tenant.businessName}`,
    text: [
      `Hi ${user.name},`,
      ``,
      `Your BizzCore account for ${tenant.businessName} is ready.`,
      ``,
      `Login: ${APP_LOGIN_URL}`,
      `Email: ${user.email}`,
      `Temporary password: ${tempPassword}`,
      ``,
      `You'll be asked to set a new password on first login.`,
    ].join("\n"),
  });

  let smsResult: SmsResult | null = null;
  if (user.phone) {
    smsResult = await sendSms({
      to: user.phone,
      body: `BizzCore: your login for ${tenant.businessName} is ready. Email: ${user.email}  Temp password: ${tempPassword}  Login: ${APP_LOGIN_URL}`,
    });
  }

  const allDelivered = emailResult.delivered && (smsResult === null || smsResult.delivered);

  return {
    email: emailResult,
    sms: smsResult,
    // Only surfaced on-screen when live delivery didn't fully succeed —
    // if email (and SMS, when applicable) went out for real, the temp
    // password shouldn't also sit in plaintext in an API response.
    fallback: allDelivered ? undefined : { tempPassword, loginUrl: APP_LOGIN_URL },
  };
}

router.get("/businesses", async (req, res) => {
  // Soft-deleted tenants (deletedAt set) are hidden from the default list —
  // that's what "disappears from the dashboard" means for soft delete —
  // and only surfaced via ?includeDeleted=true, for the Businesses page's
  // "Show deleted" filter (recovery path for soft delete).
  const includeDeleted = req.query.includeDeleted === "true";
  const tenants = await prisma.tenant.findMany({
    where: includeDeleted ? undefined : { deletedAt: null },
    orderBy: { createdAt: "desc" },
  }); // cross-tenant: super-admin

  const businesses = await Promise.all(
    tenants.map(async (tenant) => {
      const [customerCount, lastLoginUser] = await Promise.all([
        prisma.customer.count({ where: { tenantId: tenant.id } }), // cross-tenant: super-admin, scoped to this row's own tenant
        prisma.user.findFirst({
          where: { tenantId: tenant.id, lastLoginAt: { not: null } }, // cross-tenant: super-admin, scoped to this row's own tenant
          orderBy: { lastLoginAt: "desc" },
          select: { lastLoginAt: true },
        }),
      ]);
      return {
        id: tenant.id,
        businessName: tenant.businessName,
        websiteUrl: tenant.websiteUrl,
        ownerEmail: tenant.ownerEmail,
        ownerPhone: tenant.ownerPhone,
        status: tenant.status,
        logoUrl: tenant.logoUrl,
        deletedAt: tenant.deletedAt,
        createdAt: tenant.createdAt,
        customerCount,
        lastLogin: lastLoginUser?.lastLoginAt ?? null,
      };
    })
  );

  res.json(businesses);
});

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  websiteUrl: z.string().trim().url("Enter a valid website URL").optional().or(z.literal("")),
  ownerName: z.string().trim().min(1, "Owner name is required"),
  ownerEmail: z.string().trim().email("Enter a valid email"),
  ownerPhone: z.string().trim().min(1).optional().or(z.literal("")),
});

router.post("/businesses", handleUpload(logoUpload.single("logo")), async (req, res) => {
  const parsed = createBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { businessName, ownerName } = parsed.data;
  const ownerEmail = parsed.data.ownerEmail.toLowerCase();
  const websiteUrl = parsed.data.websiteUrl || undefined;
  const ownerPhone = parsed.data.ownerPhone || undefined;

  const existing = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const { tenant, admin } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        businessName,
        websiteUrl: websiteUrl ?? null,
        ownerEmail,
        ownerPhone: ownerPhone ?? null,
        status: "Active",
      },
    });
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone ?? null,
        passwordHash,
        role: "ADMIN",
        mustChangePassword: true,
      },
    });
    return { tenant, admin };
  });

  // The tenant doesn't exist until the instant above, so the logo (if any)
  // can only be written to its uploads dir now, not via the usual
  // per-request tenant-scoped uploader — see saveBufferForTenant's comment.
  let logoUrl: string | null = null;
  if (req.file) {
    logoUrl = saveBufferForTenant(tenant.id, "branding", req.file.originalname, req.file.buffer);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { logoUrl } });
  }

  const delivery = await deliverCredentials(tenant, admin, tempPassword);

  await logAudit(req.user!.id, "BUSINESS_CREATED", tenant.id, {
    businessName: tenant.businessName,
    ownerEmail: admin.email,
    emailDelivered: delivery.email.delivered,
    smsAttempted: delivery.sms !== null,
    smsDelivered: delivery.sms?.delivered ?? null,
  });

  res.status(201).json({
    tenant: {
      id: tenant.id,
      businessName: tenant.businessName,
      status: tenant.status,
      logoUrl,
      createdAt: tenant.createdAt,
    },
    admin: { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone },
    delivery,
  });
});

router.get("/businesses/:id", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, include: { plan: true } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [users, customerCount, auditEntries] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: tenant.id }, // cross-tenant: super-admin, scoped to this specific tenant
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where: { tenantId: tenant.id } }), // cross-tenant: super-admin, scoped to this specific tenant
    prisma.auditLog.findMany({
      where: { targetTenantId: tenant.id }, // cross-tenant: super-admin, scoped to this specific tenant
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);

  res.json({
    tenant,
    users,
    stats: { customerCount },
    auditLog: auditEntries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor: entry.actor.name,
      actorEmail: entry.actor.email,
      details: entry.details ? JSON.parse(entry.details) : null,
      createdAt: entry.createdAt,
    })),
  });
});

const statusSchema = z.object({ status: z.enum(["Active", "Suspended"]) });

router.patch("/businesses/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Status must be Active or Suspended" });
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const previousStatus = tenant.status;
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { status: parsed.data.status },
  });

  await logAudit(
    req.user!.id,
    parsed.data.status === "Suspended" ? "BUSINESS_SUSPENDED" : "BUSINESS_REACTIVATED",
    tenant.id,
    { previousStatus, newStatus: parsed.data.status }
  );

  res.json(updated);
});

const updateBusinessSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").optional(),
  websiteUrl: z.string().trim().url("Enter a valid website URL").optional().or(z.literal("")),
  customDomain: z.string().trim().min(1).optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  ownerName: z.string().trim().min(1, "Owner name is required").optional(),
  ownerEmail: z.string().trim().email("Enter a valid email").optional(),
  ownerPhone: z.string().trim().optional().or(z.literal("")),
});

// Full tenant edit: Super Admin can change every field listed in the spec
// (Business Name, Website Base URL, Custom Domain, Address, logo, and the
// owner's Name/Email/Phone) from the dashboard, no DB/env access needed.
// "Owner Name/Email/Phone" aren't Tenant columns on their own — Email/Phone
// are denormalized onto Tenant (for the Businesses list without a join, see
// GET /businesses) AND live on the primary ADMIN User; Name only lives on
// that User. This route keeps both in sync so an owner-email edit actually
// changes their login, not just a display string.
router.patch("/businesses/:id", handleUpload(logoUpload.single("logo")), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = updateBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const data = parsed.data;

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: "ADMIN" }, // cross-tenant: super-admin, scoped to this specific tenant
    orderBy: { createdAt: "asc" },
  });

  const newEmail = data.ownerEmail ? data.ownerEmail.toLowerCase() : undefined;
  if (newEmail && newEmail !== tenant.ownerEmail) {
    const existingWithEmail = await prisma.user.findUnique({ where: { email: newEmail } });
    if (existingWithEmail && existingWithEmail.id !== admin?.id) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
  }

  const newCustomDomain = data.customDomain !== undefined ? data.customDomain.trim() || null : undefined;
  if (newCustomDomain) {
    const existingDomain = await prisma.tenant.findUnique({ where: { customDomain: newCustomDomain } });
    if (existingDomain && existingDomain.id !== tenant.id) {
      res.status(409).json({ error: "This custom domain is already in use by another business" });
      return;
    }
  }

  let logoUrl = tenant.logoUrl;
  if (req.file) {
    logoUrl = saveBufferForTenant(tenant.id, "branding", req.file.originalname, req.file.buffer);
  }

  const before = {
    businessName: tenant.businessName,
    websiteUrl: tenant.websiteUrl,
    customDomain: tenant.customDomain,
    address: tenant.address,
    ownerEmail: tenant.ownerEmail,
    ownerPhone: tenant.ownerPhone,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const tenantUpdate = await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        businessName: data.businessName,
        websiteUrl: data.websiteUrl !== undefined ? data.websiteUrl || null : undefined,
        customDomain: newCustomDomain,
        address: data.address !== undefined ? data.address || null : undefined,
        ownerEmail: newEmail,
        ownerPhone: data.ownerPhone !== undefined ? data.ownerPhone || null : undefined,
        logoUrl,
      },
    });

    if (admin && (data.ownerName !== undefined || newEmail || data.ownerPhone !== undefined)) {
      await tx.user.update({
        where: { id: admin.id },
        data: {
          name: data.ownerName,
          email: newEmail,
          phone: data.ownerPhone !== undefined ? data.ownerPhone || null : undefined,
        },
      });
    }

    return tenantUpdate;
  });

  // Old logo removed only after the transaction commits — if the update
  // failed, the still-referenced file must not be deleted.
  if (req.file && tenant.logoUrl) deleteUploadedFile(tenant.logoUrl);

  await logAudit(req.user!.id, "BUSINESS_UPDATED", tenant.id, {
    before,
    after: {
      businessName: updated.businessName,
      websiteUrl: updated.websiteUrl,
      customDomain: updated.customDomain,
      address: updated.address,
      ownerEmail: updated.ownerEmail,
      ownerPhone: updated.ownerPhone,
    },
  });

  res.json(updated);
});

const deleteBusinessSchema = z.object({
  permanent: z.boolean().optional(),
  confirmName: z.string().trim().min(1, "Confirmation text is required"),
});

// Soft delete (default) sets deletedAt — the business disappears from the
// dashboard (GET /businesses) and can no longer log in (routes/auth.ts,
// middleware/resolveTenant.ts) but every row survives, recoverable via
// POST /businesses/:id/restore. Permanent delete removes the Tenant row
// itself; every other tenant-owned table cascades via the onDelete: Cascade
// relations declared in schema.prisma (verified against the generated SQL:
// these are real DB-level FK constraints, not app-emulated, so the single
// prisma.tenant.delete() below is already one atomic statement — the
// $transaction wrapper makes "single database transaction" literal, not
// load-bearing on its own). AuditLog rows about this tenant are NOT
// deleted — see schema.prisma's AuditLog.targetTenant comment for why
// SetNull (detach, don't destroy) is the correct behavior for a compliance
// trail, even on an irreversible action.
router.delete("/businesses/:id", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = deleteBusinessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { permanent, confirmName } = parsed.data;

  // Never trust the frontend's own confirmation gate for an irreversible
  // action — re-validate server-side that the caller actually typed the
  // business name (or the literal "DELETE") before proceeding.
  if (confirmName !== tenant.businessName && confirmName !== "DELETE") {
    res.status(400).json({ error: "Confirmation text does not match. Type the business name or DELETE to confirm." });
    return;
  }

  // Permanent delete is allowed regardless of current soft-delete state —
  // "empty the recycle bin" on an already soft-deleted tenant is the
  // natural next step, not an error. Only re-running a SOFT delete on an
  // already soft-deleted tenant is rejected as a no-op.
  if (permanent) {
    // Snapshot before the row is gone — the sole surviving record of what
    // was destroyed, since the Tenant row itself won't exist to look up.
    const snapshot = {
      id: tenant.id,
      businessName: tenant.businessName,
      ownerEmail: tenant.ownerEmail,
      ownerPhone: tenant.ownerPhone,
      status: tenant.status,
      createdAt: tenant.createdAt,
    };

    await prisma.$transaction([prisma.tenant.delete({ where: { id: tenant.id } })]);

    // Best-effort filesystem cleanup — not transactional with the (already
    // committed, irreversible) DB delete above, so an fs error is logged,
    // not surfaced as a request failure.
    fs.rm(path.join(UPLOADS_ROOT, tenant.id), { recursive: true, force: true }, (err) => {
      if (err) console.error(`Failed to remove uploads for permanently deleted tenant ${tenant.id}`, err);
    });

    await logAudit(req.user!.id, "BUSINESS_PERMANENTLY_DELETED", null, snapshot);
    res.status(204).send();
    return;
  }

  if (tenant.deletedAt) {
    res.status(409).json({ error: "This business is already deleted." });
    return;
  }

  await prisma.tenant.update({ where: { id: tenant.id }, data: { deletedAt: new Date() } });
  await logAudit(req.user!.id, "BUSINESS_SOFT_DELETED", tenant.id, { businessName: tenant.businessName });
  res.status(204).send();
});

router.post("/businesses/:id/restore", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!tenant.deletedAt) {
    res.status(409).json({ error: "This business is not deleted." });
    return;
  }

  const restored = await prisma.tenant.update({ where: { id: tenant.id }, data: { deletedAt: null } });
  await logAudit(req.user!.id, "BUSINESS_RESTORED", tenant.id, { businessName: tenant.businessName });
  res.json(restored);
});

// Business Admin's per-feature permission (VIEW/MANAGE) is now set
// directly on that feature's WebsiteIntegration row (PUT
// /api/super-admin/website-integrations/:tenantId/:featureKey — see
// lib/websiteIntegrationConfig.ts's saveIntegration/permissionLevel)
// rather than a tenant-wide toggle here — permission is per-feature, not
// per-tenant.

router.post("/businesses/:id/resend-credentials", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } }); // cross-tenant: super-admin
  if (!tenant) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: "ADMIN" }, // cross-tenant: super-admin, scoped to this specific tenant
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    res.status(404).json({ error: "No admin user found for this business" });
    return;
  }

  // Passwords are never stored in plaintext, so a resend can't replay the
  // original — it issues a fresh temporary password and forces another
  // change-on-next-login.
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash, mustChangePassword: true },
  });

  const delivery = await deliverCredentials(tenant, admin, tempPassword);

  await logAudit(req.user!.id, "CREDENTIALS_RESENT", tenant.id, {
    adminEmail: admin.email,
    emailDelivered: delivery.email.delivered,
    smsAttempted: delivery.sms !== null,
    smsDelivered: delivery.sms?.delivered ?? null,
  });

  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email }, delivery });
});

router.get("/audit-log", async (_req, res) => {
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      actor: { select: { name: true, email: true } },
      targetTenant: { select: { businessName: true } },
    },
  }); // cross-tenant: super-admin, this endpoint's entire purpose is a cross-tenant view

  res.json(
    entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor: entry.actor.name,
      actorEmail: entry.actor.email,
      targetBusinessName: entry.targetTenant?.businessName ?? null,
      details: entry.details ? JSON.parse(entry.details) : null,
      createdAt: entry.createdAt,
    }))
  );
});

export default router;
