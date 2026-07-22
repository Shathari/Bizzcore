import { apiClient } from "./client";

// Super-Admin-only: CRUD on ONE tenant's own Feature catalog
// (routes/superAdminFeatureCatalog.ts) — this is what makes custom
// features (Blogs, FAQs, Order Enquiries, ...) possible with zero backend
// code changes. Since the tenant-scoping migration, every tenant has its
// own independent copy; a Feature created here only ever exists for the
// one tenant passed in, never shared with or visible to any other.
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

export async function listFeatureCatalog(tenantId: string): Promise<FeatureDefinition[]> {
  const { data } = await apiClient.get<FeatureDefinition[]>(`/super-admin/feature-catalog/${tenantId}`);
  return data;
}

export async function createFeatureCatalogEntry(
  tenantId: string,
  input: {
    key?: string;
    label: string;
    singularLabel?: string;
    isSingleton?: boolean;
    fields: FieldDef[];
  }
): Promise<FeatureDefinition> {
  const { data } = await apiClient.post<FeatureDefinition>(`/super-admin/feature-catalog/${tenantId}`, input);
  return data;
}

export async function updateFeatureCatalogEntry(
  id: string,
  input: {
    label?: string;
    singularLabel?: string | null;
    isSingleton?: boolean;
    fields?: FieldDef[];
  }
): Promise<FeatureDefinition> {
  const { data } = await apiClient.patch<FeatureDefinition>(`/super-admin/feature-catalog/id/${id}`, input);
  return data;
}

export async function deleteFeatureCatalogEntry(id: string): Promise<void> {
  await apiClient.delete(`/super-admin/feature-catalog/id/${id}`);
}
