import { prisma } from "./prisma";

// Field-type set the dashboard already knows how to render (see
// frontend/src/pages/tenant/WebsiteGenericContent.tsx's FieldInputs) —
// custom features created via the Feature Catalog reuse the same
// rendering code, no new types needed for "unlimited custom features".
export type FieldDef =
  | { key: string; label: string; type: "text" | "textarea" | "number" | "date" | "image"; required?: boolean }
  | { key: string; label: string; type: "select"; required?: boolean; options: string[] }
  | { key: string; label: string; type: "checkbox" };

export type FeatureDefinition = {
  id: string;
  tenantId: string;
  key: string;
  label: string;
  singularLabel: string | null;
  isBuiltIn: boolean;
  isSingleton: boolean;
  fields: FieldDef[];
};

function toDefinition(row: {
  id: string;
  tenantId: string;
  key: string;
  label: string;
  singularLabel: string | null;
  isBuiltIn: boolean;
  isSingleton: boolean;
  fields: string;
}): FeatureDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    label: row.label,
    singularLabel: row.singularLabel,
    isBuiltIn: row.isBuiltIn,
    isSingleton: row.isSingleton,
    fields: JSON.parse(row.fields),
  };
}

export type FeatureTemplateDefinition = {
  key: string;
  label: string;
  singularLabel: string | null;
  isSingleton: boolean;
  fields: FieldDef[];
};

function toTemplateDefinition(row: { key: string; label: string; singularLabel: string | null; isSingleton: boolean; fields: string }): FeatureTemplateDefinition {
  return {
    key: row.key,
    label: row.label,
    singularLabel: row.singularLabel,
    isSingleton: row.isSingleton,
    fields: JSON.parse(row.fields),
  };
}

// Keyed `${tenantId}::${key}` — every tenant's Feature is now an
// independent row (see prisma/scripts/tenant-scope-features.ts), so a
// single global cache keyed on `key` alone would either merge two
// tenants' entries or randomly serve one tenant's data to another,
// depending on insertion order. Read on effectively every website-content
// request across 4+ route files — cached in-memory rather than
// round-tripping to the DB each time, invalidated on every catalog write
// below (rare: only Feature Catalog edits), no TTL needed.
let cache: Map<string, FeatureDefinition> | null = null;
// Tracks which tenants have already had every FeatureTemplate cloned into
// their own Feature rows (see ensureBuiltIns) so that check itself isn't
// repeated on every single call once done for a given tenant this process
// lifetime. Cleared alongside `cache` on invalidation for consistency,
// though nothing currently un-clones a tenant's built-ins.
let ensuredTenants: Set<string> | null = null;

function invalidateCache() {
  cache = null;
  ensuredTenants = null;
}

// Deliberately uncached, unlike `cache`/`ensuredTenants` above: FeatureTemplate
// only changes via an out-of-process reseed (see seedBuiltInFeatures), which
// this running server has no way to be notified of — a cached copy here would
// silently keep serving stale templates to newly-provisioned tenants for the
// rest of the process's life. The table is a handful of rows and this only
// runs once per not-yet-ensured tenant, so the extra query is negligible.
async function loadTemplates(): Promise<Map<string, FeatureTemplateDefinition>> {
  const rows = await prisma.featureTemplate.findMany();
  return new Map(rows.map((row) => [row.key, toTemplateDefinition(row)]));
}

// Clone-on-first-access: the first time ANY code asks about this tenant's
// feature catalog, give them their own independent copy of every built-in
// template they don't already have a Feature row for. Idempotent (checked
// against existing keys first) and additive-only — never touches a
// built-in the tenant has already started customizing. This is what makes
// "each tenant gets an independent, editable copy" true without requiring
// an explicit provisioning step anywhere else (tenant onboarding, Super
// Admin business creation, ...).
//
// Deliberately a one-time snapshot, not a live read-through: once this has
// run for a tenant, that tenant's Feature rows are its own history from
// here on, full stop. If FeatureTemplate is later changed (currently only
// possible by editing BUILT_IN_FEATURES and re-running seedBuiltInFeatures
// — there is no admin UI or route that edits FeatureTemplate directly),
// that change intentionally does NOT retroactively touch any tenant who
// already has their own row for that key, customized or not. Same
// principle as picking a starter template that becomes your own document
// the moment you create it. If this ever needs to change to true
// live-until-customized read-through, that's a different function, not a
// tweak to this one.
async function ensureBuiltIns(tenantId: string): Promise<void> {
  if (ensuredTenants?.has(tenantId)) return;

  const [templates, existing] = await Promise.all([
    loadTemplates(),
    prisma.feature.findMany({ where: { tenantId }, select: { key: true } }),
  ]);
  const existingKeys = new Set(existing.map((f) => f.key));
  const missing = [...templates.values()].filter((t) => !existingKeys.has(t.key));

  if (missing.length > 0) {
    await prisma.feature.createMany({
      data: missing.map((t) => ({
        tenantId,
        key: t.key,
        label: t.label,
        singularLabel: t.singularLabel,
        isBuiltIn: true,
        isSingleton: t.isSingleton,
        fields: JSON.stringify(t.fields),
      })),
    });
    cache = null; // newly-created rows must be visible to the next cache load
  }

  ensuredTenants = ensuredTenants ?? new Set();
  ensuredTenants.add(tenantId);
}

async function loadCache(): Promise<Map<string, FeatureDefinition>> {
  if (cache) return cache;
  const rows = await prisma.feature.findMany();
  cache = new Map(rows.map((row) => [`${row.tenantId}::${row.key}`, toDefinition(row)]));
  return cache;
}

export async function getFeatureByKey(tenantId: string, key: string): Promise<FeatureDefinition | null> {
  await ensureBuiltIns(tenantId);
  const map = await loadCache();
  return map.get(`${tenantId}::${key}`) ?? null;
}

export async function listFeatures(tenantId: string): Promise<FeatureDefinition[]> {
  await ensureBuiltIns(tenantId);
  const map = await loadCache();
  return [...map.values()].filter((f) => f.tenantId === tenantId);
}

export type CreateFeatureInput = {
  key: string;
  label: string;
  singularLabel?: string | null;
  isSingleton?: boolean;
  fields: FieldDef[];
};

export async function createFeature(tenantId: string, input: CreateFeatureInput): Promise<FeatureDefinition> {
  const row = await prisma.feature.create({
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
  invalidateCache();
  return toDefinition(row);
}

export type UpdateFeatureInput = {
  label?: string;
  singularLabel?: string | null;
  isSingleton?: boolean;
  fields?: FieldDef[];
};

// `tenantId` is a defense-in-depth ownership check, not the primary
// scoping mechanism (that's `id`, already unique to one tenant's row) — a
// route that resolved `id` under the wrong tenant's assumption fails loud
// here instead of silently editing a different tenant's Feature.
export async function updateFeature(id: string, tenantId: string, input: UpdateFeatureInput): Promise<FeatureDefinition | null> {
  const existing = await prisma.feature.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;

  const row = await prisma.feature.update({
    where: { id },
    data: {
      label: input.label,
      singularLabel: input.singularLabel,
      isSingleton: input.isSingleton,
      fields: input.fields ? JSON.stringify(input.fields) : undefined,
    },
  });
  invalidateCache();
  return toDefinition(row);
}

export type DeleteFeatureResult = { ok: true } | { ok: false; error: string };

// Built-ins are permanently undeletable for a given tenant (a deliberate,
// usage-independent guard — same rule as before, now per-tenant) — custom
// features can be deleted only once no longer referenced by that tenant's
// own WebsiteIntegration, so removing the catalog entry never orphans
// this tenant's configured integration or content data. Cross-tenant
// deletion is structurally impossible now (id resolves to exactly one
// tenant's row), so unlike updateFeature this doesn't need a separate
// tenantId ownership parameter — callers still pass the id from a
// tenant-scoped lookup.
export async function deleteFeature(id: string): Promise<DeleteFeatureResult> {
  const feature = await prisma.feature.findUnique({ where: { id } });
  if (!feature) return { ok: false, error: "Not found" };
  if (feature.isBuiltIn) return { ok: false, error: "Built-in features can't be deleted." };

  const inUse = await prisma.websiteIntegration.count({ where: { featureId: id } });
  if (inUse > 0) {
    return { ok: false, error: `Still mapped for ${inUse} connector${inUse === 1 ? "" : "s"} — remove that mapping first.` };
  }

  await prisma.feature.delete({ where: { id } });
  invalidateCache();
  return { ok: true };
}
