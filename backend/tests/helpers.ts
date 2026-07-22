import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { getFeatureByKey } from "../src/lib/featureCatalog";
import { encryptField, maskPhone, hashForLookup, monthDayOf, normalizePhone } from "../src/lib/piiCrypto";

export const app = createApp();

export const TEST_PASSWORD = "TestPass123!";

export async function createTenantWithAdmin(businessName = "Test Boutique") {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: {
      businessName: `${businessName} ${suffix}`,
      ownerEmail: `owner-${suffix}@test.example`,
      status: "Active",
    },
  });
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Test Admin",
      email: `admin-${suffix}@test.example`,
      passwordHash,
      role: "ADMIN",
      mustChangePassword: false,
    },
  });
  return { tenant, admin };
}

// Maps a feature (built-in, cloned on first access from the FeatureTemplate
// seeded by tests/globalSetup.ts, or custom, via createCustomFeature below)
// to a tenant's external API — the direct-Prisma equivalent of what a
// tenant Admin does through routes/connectorConfig.ts, skipping HTTP for
// test setup speed. `permissionLevel` defaults to VIEW (secure by default,
// same as the real column default). Goes through getFeatureByKey (not a
// raw prisma.feature lookup) so a built-in key that this tenant hasn't
// touched yet gets cloned into its own row first, same as the real app.
export async function configureIntegration(
  tenantId: string,
  featureKey: string,
  baseUrl = "https://example.com/api/thing",
  options: {
    permissionLevel?: "VIEW" | "MANAGE";
    authType?: string;
    lookupKey?: string | null;
    fieldMapping?: Record<string, string>;
    responseMapping?: { listPath?: string; itemPath?: string };
  } = {}
) {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) throw new Error(`configureIntegration: unknown feature key "${featureKey}" for tenant ${tenantId}`);
  return prisma.websiteIntegration.create({
    data: {
      tenantId,
      featureId: feature.id,
      baseUrl,
      authType: options.authType ?? "none",
      active: true,
      permissionLevel: options.permissionLevel ?? "VIEW",
      lookupKey: options.lookupKey ?? null,
      fieldMapping: options.fieldMapping ? JSON.stringify(options.fieldMapping) : null,
      responseMapping: options.responseMapping ? JSON.stringify(options.responseMapping) : null,
    },
  });
}

// Creates a brand-new custom Feature directly (bypassing the Feature
// Catalog API) for tests that need one to already exist before exercising
// the dynamic-feature behavior itself. Tenant-scoped: this row only ever
// exists for the one tenant passed in.
export async function createCustomFeature(
  tenantId: string,
  input: {
    key: string;
    label: string;
    singularLabel?: string;
    isSingleton?: boolean;
    fields: Array<Record<string, unknown>>;
  }
) {
  return prisma.feature.create({
    data: {
      tenantId,
      key: input.key,
      label: input.label,
      singularLabel: input.singularLabel ?? null,
      isSingleton: input.isSingleton ?? false,
      isBuiltIn: false,
      fields: JSON.stringify(input.fields),
    },
  });
}

// Customer.phone/birthday are encrypted at rest (see lib/piiCrypto.ts) and
// phoneMasked/phoneHash are required columns — tests that need a Customer
// row to exist (tenant isolation, dashboard, super-admin business deletion,
// etc.) go through here instead of a raw prisma.customer.create so they stay
// valid against the real schema without each test re-deriving the encrypted
// shape by hand.
export async function createTestCustomer(
  tenantId: string,
  overrides: { name?: string; phone?: string; birthday?: string } & Record<string, unknown> = {}
) {
  const { name, phone, birthday, ...rest } = overrides;
  const plainPhone = phone ?? "+919800000000";
  const birthdayDate = birthday ? new Date(birthday) : null;
  return prisma.customer.create({
    data: {
      tenantId,
      name: name ?? "Test Customer",
      phone: encryptField(plainPhone),
      phoneMasked: maskPhone(plainPhone),
      phoneHash: hashForLookup(normalizePhone(plainPhone)),
      birthday: birthdayDate ? encryptField(birthdayDate.toISOString()) : null,
      birthdayMonthDay: birthdayDate ? monthDayOf(birthdayDate) : null,
      ...rest,
    },
  });
}

// Entitlement enforcement (lib/entitlements.ts) means a bare
// createTenantWithAdmin tenant (no plan) is now blocked from every gated
// route (AI generate, WhatsApp send, scheduled posts, CMS item creation
// beyond 0, connector import/sync). Tests that exercise those routes for
// their OWN reasons — not testing entitlements themselves — call this to
// get a permissive plan so pre-existing behavior keeps working. Enterprise
// has every relevant feature included with "unlimited" or very high caps.
export async function grantPermissivePlan(tenantId: string) {
  const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Enterprise / Business OS" } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id } });
  return plan;
}

export async function createSuperAdmin() {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      tenantId: null,
      name: "Test Super Admin",
      email: `super-${suffix}@test.example`,
      passwordHash,
      role: "SUPER_ADMIN",
      mustChangePassword: false,
    },
  });
  return { user };
}

// Logs in via the real /api/auth/login route (not a shortcut) so tests
// exercise the actual auth path, and returns the session cookie for use
// in subsequent requests.
export async function loginAs(email: string, password: string = TEST_PASSWORD): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  const cookie = res.headers["set-cookie"]?.[0];
  if (!cookie) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return cookie.split(";")[0];
}
