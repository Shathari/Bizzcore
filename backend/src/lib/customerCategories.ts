import { prisma } from "./prisma";

const BUILT_INS: Array<{ name: string; isPriority: boolean }> = [
  { name: "Regular", isPriority: false },
  { name: "VIP", isPriority: true },
  { name: "Bridal", isPriority: true },
];

// Clone-on-first-access, same pattern as lib/featureCatalog.ts's
// ensureBuiltIns: the first time any code asks about this tenant's customer
// categories, seed the three defaults if the tenant has none at all yet.
// Idempotent — a tenant that already has at least one category (built-in or
// custom) is left untouched. If a tenant later deletes every category, the
// next call reseeds the same three defaults rather than ever leaving the
// tenant with zero categories to assign.
const ensuredTenants = new Set<string>();

export async function ensureBuiltInCategories(tenantId: string): Promise<void> {
  if (ensuredTenants.has(tenantId)) return;

  const count = await prisma.customerCategory.count({ where: { tenantId } });
  if (count === 0) {
    await prisma.customerCategory.createMany({
      data: BUILT_INS.map((b, i) => ({
        tenantId,
        name: b.name,
        isBuiltIn: true,
        isPriority: b.isPriority,
        sortOrder: i,
      })),
    });
  }
  ensuredTenants.add(tenantId);
}

export async function listCategories(tenantId: string) {
  await ensureBuiltInCategories(tenantId);
  return prisma.customerCategory.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function listCategoryNames(tenantId: string): Promise<string[]> {
  return (await listCategories(tenantId)).map((c) => c.name);
}

// Backs routes/dashboard.ts's "priority follow-ups" stat — replaces what
// used to be a hardcoded `["VIP", "Bridal"]` list with whichever categories
// this tenant currently has flagged isPriority.
export async function listPriorityCategoryNames(tenantId: string): Promise<string[]> {
  return (await listCategories(tenantId)).filter((c) => c.isPriority).map((c) => c.name);
}

export async function isValidCategory(tenantId: string, name: string): Promise<boolean> {
  return (await listCategoryNames(tenantId)).includes(name);
}
