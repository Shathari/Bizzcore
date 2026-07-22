import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { seedBuiltInFeatures } from "./builtInFeatures";
import { seedSubscriptionPlans } from "./seedPlans";
import { seedAddOnCatalog } from "./seedAddOns";
import { getFeatureByKey } from "../src/lib/featureCatalog";
import { encryptField, maskPhone, hashForLookup, monthDayOf, normalizePhone } from "../src/lib/piiCrypto";

const prisma = new PrismaClient();

// Tiny solid-color placeholder PNGs so seeded banners render something
// real instead of a broken-image icon — actual tenant uploads go through
// the Website Manager's upload flow, this is demo data only.
const PLACEHOLDER_PNGS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", // red
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", // blue
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", // green
];

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

function writePlaceholderImage(publicUrl: string, variant: number) {
  const relative = publicUrl.replace(/^\/uploads\//, "");
  const dest = path.join(UPLOADS_ROOT, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(PLACEHOLDER_PNGS[variant % PLACEHOLDER_PNGS.length], "base64"));
}

const MOCK_SITE_BASE = `http://localhost:${process.env.PORT ?? 4000}/api/mock-external-site`;

// Maps a Super-Admin-configured website feature to this same backend's mock
// external-site route (routes/mockExternalSite.ts), then seeds content
// items as if they'd already round-tripped through it — so every demo
// tenant's Website Manager modules work live out of the box with no real
// third-party site required. A real deployment would have Super Admin
// point each feature at the tenant's own site instead.
async function mapWebsiteFeature(
  tenantId: string,
  featureKey: string,
  slug: string,
  items: Record<string, unknown>[],
  syncedAt: Date
) {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) throw new Error(`mapWebsiteFeature: unknown feature key "${featureKey}"`);
  await prisma.websiteIntegration.upsert({
    where: { tenantId_featureId: { tenantId, featureId: feature.id } },
    update: {},
    create: { tenantId, featureId: feature.id, baseUrl: `${MOCK_SITE_BASE}/${slug}`, authType: "none", active: true },
  });
  for (const [i, payload] of items.entries()) {
    await prisma.websiteContentItem.create({
      data: {
        tenantId,
        featureId: feature.id,
        externalId: `seed-${slug}-${i + 1}`,
        payload: JSON.stringify(payload),
        syncStatus: "synced",
        lastSyncedAt: syncedAt,
      },
    });
  }
}

async function main() {
  console.log("Seeding demo data into two isolated tenants...");

  await seedBuiltInFeatures(prisma);
  await seedSubscriptionPlans(prisma);
  await seedAddOnCatalog(prisma);

  const superAdminPasswordHash = await bcrypt.hash("SuperAdmin@123", 10);
  const superAdmin = await prisma.user.upsert({
    where: { email: "platform-admin@kalericonsole.com" },
    update: {},
    create: {
      tenantId: null,
      name: "BizzCore Platform Admin",
      email: "platform-admin@kalericonsole.com",
      passwordHash: superAdminPasswordHash,
      role: "SUPER_ADMIN",
      mustChangePassword: false,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { id: "kaleri-saree-demo-tenant" },
    update: {},
    create: {
      id: "kaleri-saree-demo-tenant",
      businessName: "Kaleri Saree",
      websiteUrl: "https://kalerisaree.example.com",
      ownerEmail: "owner@kalerisaree.com",
      ownerPhone: "+919810000001",
      status: "Active",
      plan: null,
    },
  });

  const adminPasswordHash = await bcrypt.hash("Kaleri@123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "owner@kalerisaree.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Anjali Mehta",
      email: "owner@kalerisaree.com",
      phone: "+919810000001",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      // pre-existing demo account, not a fresh Super Admin provisioning —
      // so this does NOT require a forced password change
      mustChangePassword: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: superAdmin.id,
      action: "BUSINESS_CREATED",
      targetTenantId: tenant.id,
      details: JSON.stringify({ businessName: tenant.businessName, seed: true }),
    },
  });

  const kaleriLogo = "/uploads/kaleri-saree-demo-tenant/branding/logo.png";
  writePlaceholderImage(kaleriLogo, 0);
  await prisma.tenant.update({ where: { id: tenant.id }, data: { logoUrl: kaleriLogo } });

  const customerDefs = [
    { name: "Priya Sharma", phone: "+919811111111", email: "priya.sharma@example.com", segment: "VIP", birthday: "1990-04-12", totalSpent: 84500, lastPurchase: "2026-06-20", notes: "Prefers Kanjivaram silk, size M." },
    { name: "Ritu Kapoor", phone: "+919811111112", email: "ritu.kapoor@example.com", segment: "Bridal", birthday: "1994-11-02", totalSpent: 152000, lastPurchase: "2026-07-01", notes: "Wedding trousseau, 6 saree order in progress." },
    { name: "Neha Verma", phone: "+919811111113", email: "neha.verma@example.com", segment: "Regular", birthday: "1988-01-25", totalSpent: 12300, lastPurchase: "2026-05-14", notes: null },
    { name: "Sunita Rao", phone: "+919811111114", email: "sunita.rao@example.com", segment: "Regular", birthday: "1975-09-09", totalSpent: 8900, lastPurchase: "2026-04-02", notes: null },
    { name: "Kavya Iyer", phone: "+919811111115", email: "kavya.iyer@example.com", segment: "VIP", birthday: "1992-07-30", totalSpent: 67200, lastPurchase: "2026-06-28", notes: "Attends every trunk show." },
    { name: "Meera Nair", phone: "+919811111116", email: "meera.nair@example.com", segment: "Bridal", birthday: "1996-03-18", totalSpent: 98000, lastPurchase: "2026-07-10", notes: "Follow up on blouse alteration." },
  ];

  const customers = [];
  for (const c of customerDefs) {
    const birthdayDate = new Date(c.birthday);
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: c.name,
        // phone/birthday are encrypted at rest from the moment a row is
        // created — see lib/piiCrypto.ts. customerDefs above keeps the
        // plaintext only for building this seed data (e.g. contactHandle
        // below); the created row never holds it.
        phone: encryptField(c.phone),
        phoneMasked: maskPhone(c.phone),
        phoneHash: hashForLookup(normalizePhone(c.phone)),
        email: c.email,
        segment: c.segment,
        birthday: encryptField(birthdayDate.toISOString()),
        birthdayMonthDay: monthDayOf(birthdayDate),
        totalSpent: c.totalSpent,
        lastPurchase: new Date(c.lastPurchase),
        notes: c.notes,
      },
    });
    customers.push(customer);
  }

  // Purchases spread over the last 6 months to drive the revenue trend chart
  const now = new Date("2026-07-14");
  for (const customer of customers) {
    const purchaseCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < purchaseCount; i++) {
      const monthsAgo = Math.floor(Math.random() * 6);
      const purchasedAt = new Date(now);
      purchasedAt.setMonth(purchasedAt.getMonth() - monthsAgo);
      purchasedAt.setDate(1 + Math.floor(Math.random() * 27));
      await prisma.purchase.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          amount: 3000 + Math.floor(Math.random() * 15000),
          purchasedAt,
        },
      });
    }
  }

  const kaleriBanner1 = "/uploads/kaleri-saree-demo-tenant/banners/wedding-edit.png";
  const kaleriBanner2 = "/uploads/kaleri-saree-demo-tenant/banners/festive-sale.png";
  writePlaceholderImage(kaleriBanner1, 0);
  writePlaceholderImage(kaleriBanner2, 1);

  // Every Website Manager feature below is a Super-Admin-mapped module —
  // it only shows up in this tenant's dashboard because mapWebsiteFeature
  // configures an (active) WebsiteIntegration for it.
  await mapWebsiteFeature(
    tenant.id,
    "COLLECTIONS",
    "collections",
    [
      { name: "Wedding Edit", description: "Bridal and reception sarees" },
      { name: "Everyday Elegance", description: "Cotton and linen sarees for daily wear" },
    ],
    now
  );
  await mapWebsiteFeature(
    tenant.id,
    "PRODUCTS",
    "products",
    [
      { name: "Kanjivaram Silk — Maroon Zari", sku: "KAL-SK-001", price: 18500, fabric: "Kanjivaram Silk", color: "Maroon", stockStatus: "Available", collectionName: "Wedding Edit" },
      { name: "Banarasi Silk — Gold Weave", sku: "KAL-SK-002", price: 24500, fabric: "Banarasi Silk", color: "Gold", stockStatus: "Available", collectionName: "Wedding Edit" },
      { name: "Bridal Red Silk — Heavy Border", sku: "KAL-SK-003", price: 32000, fabric: "Silk", color: "Red", stockStatus: "Reserved", collectionName: "Wedding Edit" },
      { name: "Cotton Handloom — Indigo", sku: "KAL-CT-001", price: 3200, fabric: "Cotton", color: "Indigo", stockStatus: "Available", collectionName: "Everyday Elegance" },
      { name: "Linen — Pastel Pink", sku: "KAL-LN-001", price: 4200, fabric: "Linen", color: "Pastel Pink", stockStatus: "Available", collectionName: "Everyday Elegance" },
      { name: "Chanderi Cotton — Sage Green", sku: "KAL-CT-002", price: 5100, fabric: "Chanderi Cotton", color: "Sage Green", stockStatus: "Sold", collectionName: "Everyday Elegance" },
    ],
    now
  );
  await mapWebsiteFeature(
    tenant.id,
    "BANNERS",
    "banners",
    [
      { image: kaleriBanner1, active: true },
      { image: kaleriBanner2, active: true },
    ],
    now
  );
  await mapWebsiteFeature(
    tenant.id,
    "OFFERS",
    "offers",
    [{ title: "Festive Season — 20% Off Silk Sarees", discountPercent: 20, validFrom: "2026-07-01", validTo: "2026-08-15", active: true }],
    now
  );
  await mapWebsiteFeature(
    tenant.id,
    "CATEGORIES",
    "categories",
    [{ name: "Wedding Sarees", description: "Bridal and reception collections" }],
    now
  );

  const conv1 = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      customerId: customers[1].id,
      channel: "WHATSAPP",
      contactName: customers[1].name,
      contactHandle: customerDefs[1].phone,
      lastMessageAt: new Date("2026-07-13T10:15:00"),
    },
  });
  await prisma.message.createMany({
    data: [
      { tenantId: tenant.id, conversationId: conv1.id, direction: "INBOUND", body: "Hi, can you confirm the blouse size for my bridal order?", sentAt: new Date("2026-07-13T10:10:00") },
      { tenantId: tenant.id, conversationId: conv1.id, direction: "OUTBOUND", body: "Yes! We have it noted as size M with a 0.5 inch margin for alteration.", sentAt: new Date("2026-07-13T10:15:00") },
    ],
  });

  const conv2 = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      customerId: customers[0].id,
      channel: "INSTAGRAM_DM",
      contactName: customers[0].name,
      contactHandle: "@priya.sharma",
      lastMessageAt: new Date("2026-07-14T08:30:00"),
    },
  });
  await prisma.message.create({
    data: { tenantId: tenant.id, conversationId: conv2.id, direction: "INBOUND", body: "Do you have the Kanjivaram in a lighter maroon?", sentAt: new Date("2026-07-14T08:30:00") },
  });

  await prisma.inquiry.createMany({
    data: [
      { tenantId: tenant.id, customerId: customers[0].id, source: "INSTAGRAM", message: "Do you have the Kanjivaram in a lighter maroon?", status: "open", createdAt: new Date("2026-07-14T08:30:00") },
      { tenantId: tenant.id, customerId: null, source: "WEBSITE", message: "What are your shipping timelines for bridal orders?", status: "open", createdAt: new Date("2026-07-14T09:05:00") },
      { tenantId: tenant.id, customerId: customers[4].id, source: "WHATSAPP", message: "Interested in the Wedding Edit collection.", status: "followed_up", createdAt: new Date("2026-07-13T16:20:00") },
    ],
  });

  const visits = [];
  for (let i = 0; i < 40; i++) {
    const visitedAt = new Date(now);
    visitedAt.setDate(visitedAt.getDate() - Math.floor(Math.random() * 14));
    visits.push({ tenantId: tenant.id, path: "/", visitedAt });
  }
  await prisma.websiteVisit.createMany({ data: visits });

  const kaleriPostMedia = "/uploads/kaleri-saree-demo-tenant/social/wedding-edit-post.png";
  writePlaceholderImage(kaleriPostMedia, 0);
  await prisma.scheduledContent.createMany({
    data: [
      {
        tenantId: tenant.id,
        kind: "SOCIAL_POST",
        channel: "INSTAGRAM",
        postType: "POST",
        caption: "Drape into the festive season with our Wedding Edit ✨",
        mediaUrl: kaleriPostMedia,
        scheduledAt: new Date("2026-07-16T11:00:00"),
        status: "scheduled",
      },
      {
        tenantId: tenant.id,
        kind: "WHATSAPP_BROADCAST",
        channel: "WHATSAPP",
        caption: "Hi {{name}}, our Festive Sale is live — 20% off silk sarees till Aug 15!",
        targetSegment: "VIP",
        scheduledAt: new Date("2026-07-15T09:00:00"),
        status: "scheduled",
      },
    ],
  });

  const conv3 = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      customerId: customers[4].id,
      channel: "FACEBOOK_DM",
      contactName: customers[4].name,
      contactHandle: "kavya.iyer.fb",
      lastMessageAt: new Date("2026-07-12T17:40:00"),
    },
  });
  await prisma.message.create({
    data: {
      tenantId: tenant.id,
      conversationId: conv3.id,
      direction: "INBOUND",
      body: "Saw your festive collection on Facebook — do you ship internationally?",
      sentAt: new Date("2026-07-12T17:40:00"),
    },
  });

  await prisma.socialComment.createMany({
    data: [
      {
        tenantId: tenant.id,
        channel: "INSTAGRAM",
        postCaption: "Drape into the festive season with our Wedding Edit ✨",
        authorName: "sareelove_deepa",
        body: "This is stunning! What's the price for the maroon one?",
        createdAt: new Date("2026-07-13T12:00:00"),
      },
      {
        tenantId: tenant.id,
        channel: "FACEBOOK",
        postCaption: "Festive Season — 20% Off Silk Sarees",
        authorName: "Rina Kapadia",
        body: "Does the offer apply to Banarasi silks too?",
        reply: "Yes, it applies storewide including Banarasi silks!",
        repliedAt: new Date("2026-07-13T15:00:00"),
        createdAt: new Date("2026-07-13T14:30:00"),
      },
    ],
  });

  await prisma.aIGeneration.create({
    data: {
      tenantId: tenant.id,
      userId: admin.id,
      contentType: "Instagram Caption",
      tone: "Elegant",
      productName: "Kanjivaram Silk — Maroon Zari",
      context: "New arrival, festive season launch",
      output: "Drape yourself in tradition — our Maroon Zari Kanjivaram is woven for moments that matter. ✨ #KaleriSaree #FestiveEdit",
    },
  });

  // ---------------------------------------------------------------------
  // Second tenant — exists solely so cross-tenant isolation has something
  // to leak into when it's audited in the final build step. Deliberately
  // separate business, separate Super-Admin-provisioned admin, separate
  // records in every resource type Tenant 1 has, so a leaked/duplicated
  // record is unambiguous. This admin is also seeded with
  // mustChangePassword: true (unlike Tenant 1's), so it doubles as the
  // fixture for testing the forced-password-change flow against a
  // freshly-provisioned account.
  // ---------------------------------------------------------------------

  const tenant2 = await prisma.tenant.upsert({
    where: { id: "rangoli-threads-demo-tenant" },
    update: {},
    create: {
      id: "rangoli-threads-demo-tenant",
      businessName: "Rangoli Threads",
      websiteUrl: "https://rangolithreads.example.com",
      ownerEmail: "owner@rangolithreads.com",
      ownerPhone: "+919822000002",
      status: "Active",
      plan: null,
    },
  });

  const admin2PasswordHash = await bcrypt.hash("Rangoli@Temp123", 10);
  const admin2 = await prisma.user.upsert({
    where: { email: "owner@rangolithreads.com" },
    update: {},
    create: {
      tenantId: tenant2.id,
      name: "Devika Rao",
      email: "owner@rangolithreads.com",
      phone: "+919822000002",
      passwordHash: admin2PasswordHash,
      role: "ADMIN",
      // simulates a freshly Super-Admin-provisioned account
      mustChangePassword: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: superAdmin.id,
      action: "BUSINESS_CREATED",
      targetTenantId: tenant2.id,
      details: JSON.stringify({ businessName: tenant2.businessName, seed: true }),
    },
  });

  const rangoliLogo = "/uploads/rangoli-threads-demo-tenant/branding/logo.png";
  writePlaceholderImage(rangoliLogo, 2);
  await prisma.tenant.update({ where: { id: tenant2.id }, data: { logoUrl: rangoliLogo } });

  const tenant2CustomerDefs = [
    { name: "Ishita Bose", phone: "+919822111111", email: "ishita.bose@example.com", segment: "VIP", birthday: "1991-02-14", totalSpent: 45200, lastPurchase: "2026-06-22", notes: "Loves block-print cottons." },
    { name: "Farah Sheikh", phone: "+919822111112", email: "farah.sheikh@example.com", segment: "Bridal", birthday: "1995-08-19", totalSpent: 118000, lastPurchase: "2026-07-05", notes: "Reception saree pending fitting." },
    { name: "Lata Joshi", phone: "+919822111113", email: "lata.joshi@example.com", segment: "Regular", birthday: "1983-12-03", totalSpent: 9600, lastPurchase: "2026-05-30", notes: null },
  ];

  const tenant2Customers = [];
  for (const c of tenant2CustomerDefs) {
    const birthdayDate = new Date(c.birthday);
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant2.id,
        name: c.name,
        phone: encryptField(c.phone),
        phoneMasked: maskPhone(c.phone),
        phoneHash: hashForLookup(normalizePhone(c.phone)),
        email: c.email,
        segment: c.segment,
        birthday: encryptField(birthdayDate.toISOString()),
        birthdayMonthDay: monthDayOf(birthdayDate),
        totalSpent: c.totalSpent,
        lastPurchase: new Date(c.lastPurchase),
        notes: c.notes,
      },
    });
    tenant2Customers.push(customer);
  }

  for (const customer of tenant2Customers) {
    for (let i = 0; i < 2; i++) {
      const monthsAgo = Math.floor(Math.random() * 4);
      const purchasedAt = new Date(now);
      purchasedAt.setMonth(purchasedAt.getMonth() - monthsAgo);
      purchasedAt.setDate(1 + Math.floor(Math.random() * 27));
      await prisma.purchase.create({
        data: {
          tenantId: tenant2.id,
          customerId: customer.id,
          amount: 2500 + Math.floor(Math.random() * 12000),
          purchasedAt,
        },
      });
    }
  }

  const rangoliBanner = "/uploads/rangoli-threads-demo-tenant/banners/block-print-edit.png";
  writePlaceholderImage(rangoliBanner, 2);

  // Deliberately maps a different subset of features than Tenant 1 (no
  // Categories here) — makes it unambiguous in a live check that each
  // business's mapped modules are independent, not a shared default set.
  await mapWebsiteFeature(
    tenant2.id,
    "COLLECTIONS",
    "collections",
    [{ name: "Block Print Edit", description: "Hand block-printed cottons and mulmul" }],
    now
  );
  await mapWebsiteFeature(
    tenant2.id,
    "PRODUCTS",
    "products",
    [
      { name: "Ajrakh Block Print — Indigo", sku: "RGL-BP-001", price: 4800, fabric: "Cotton Mulmul", color: "Indigo", stockStatus: "Available", collectionName: "Block Print Edit" },
      { name: "Bagru Print — Rust Red", sku: "RGL-BP-002", price: 3900, fabric: "Cotton", color: "Rust Red", stockStatus: "Available", collectionName: "Block Print Edit" },
      { name: "Dabu Print — Charcoal", sku: "RGL-BP-003", price: 4200, fabric: "Cotton", color: "Charcoal", stockStatus: "Reserved", collectionName: "Block Print Edit" },
    ],
    now
  );
  await mapWebsiteFeature(tenant2.id, "BANNERS", "banners", [{ image: rangoliBanner, active: true }], now);
  await mapWebsiteFeature(
    tenant2.id,
    "OFFERS",
    "offers",
    [{ title: "Monsoon Cottons — 15% Off", discountPercent: 15, validFrom: "2026-07-01", validTo: "2026-07-31", active: true }],
    now
  );

  const tenant2Conv = await prisma.conversation.create({
    data: {
      tenantId: tenant2.id,
      customerId: tenant2Customers[1].id,
      channel: "WHATSAPP",
      contactName: tenant2Customers[1].name,
      contactHandle: tenant2CustomerDefs[1].phone,
      lastMessageAt: new Date("2026-07-12T14:00:00"),
    },
  });
  await prisma.message.createMany({
    data: [
      { tenantId: tenant2.id, conversationId: tenant2Conv.id, direction: "INBOUND", body: "Can we move the reception saree fitting to next week?", sentAt: new Date("2026-07-12T13:55:00") },
      { tenantId: tenant2.id, conversationId: tenant2Conv.id, direction: "OUTBOUND", body: "Of course — how about Tuesday at 4pm?", sentAt: new Date("2026-07-12T14:00:00") },
    ],
  });

  await prisma.inquiry.create({
    data: {
      tenantId: tenant2.id,
      customerId: tenant2Customers[0].id,
      source: "WEBSITE",
      message: "Do you ship the Ajrakh prints internationally?",
      status: "open",
      createdAt: new Date("2026-07-14T07:45:00"),
    },
  });

  const tenant2Visits = [];
  for (let i = 0; i < 15; i++) {
    const visitedAt = new Date(now);
    visitedAt.setDate(visitedAt.getDate() - Math.floor(Math.random() * 14));
    tenant2Visits.push({ tenantId: tenant2.id, path: "/", visitedAt });
  }
  await prisma.websiteVisit.createMany({ data: tenant2Visits });

  const rangoliPostMedia = "/uploads/rangoli-threads-demo-tenant/social/monsoon-post.png";
  writePlaceholderImage(rangoliPostMedia, 1);
  await prisma.scheduledContent.create({
    data: {
      tenantId: tenant2.id,
      kind: "SOCIAL_POST",
      channel: "INSTAGRAM",
      postType: "POST",
      caption: "Monsoon-ready block prints, straight from the block to your wardrobe 🌧️",
      mediaUrl: rangoliPostMedia,
      scheduledAt: new Date("2026-07-17T10:00:00"),
      status: "scheduled",
    },
  });

  await prisma.socialComment.create({
    data: {
      tenantId: tenant2.id,
      channel: "INSTAGRAM",
      postCaption: "Monsoon-ready block prints, straight from the block to your wardrobe 🌧️",
      authorName: "indigo_threads_fan",
      body: "Love the Ajrakh print! Is it pre-shrunk?",
      createdAt: new Date("2026-07-13T09:15:00"),
    },
  });

  await prisma.aIGeneration.create({
    data: {
      tenantId: tenant2.id,
      userId: admin2.id,
      contentType: "Product Description",
      tone: "Minimal",
      productName: "Ajrakh Block Print — Indigo",
      context: "New arrival, monsoon collection",
      output: "Hand block-printed in traditional Ajrakh indigo, this mulmul cotton saree is monsoon-season ease with heritage craft at its core.",
    },
  });

  console.log("Seed complete.");
  console.log(`  Super Admin login: platform-admin@kalericonsole.com / SuperAdmin@123`);
  console.log(`  Tenant admin login: owner@kalerisaree.com / Kaleri@123  (tenant: ${tenant.businessName})`);
  console.log(`  Tenant admin login: owner@rangolithreads.com / Rangoli@Temp123  (tenant: ${tenant2.businessName}, mustChangePassword: true)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
