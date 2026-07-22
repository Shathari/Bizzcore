import { apiClient } from "./client";

// Feature identity is now a dynamic string key resolved against the
// Feature catalog (see api/featureCatalog.ts), not a hardcoded union —
// Super Admin can create unlimited custom features with zero frontend
// code changes. `ModuleInfo` is what routes/websiteContent.ts's and
// routes/superAdminWebsiteContent.ts's /modules endpoints return: enough
// to render the feature's form and gate write access, without ever
// including baseUrl/authType/credentials.
export type WebsiteContentType = string;

export type FieldDef =
  | { key: string; label: string; type: "text" | "textarea" | "number" | "date" | "image"; required?: boolean }
  | { key: string; label: string; type: "select"; required?: boolean; options: string[] }
  | { key: string; label: string; type: "checkbox" };

export type PermissionLevel = "VIEW" | "MANAGE";

export type SyncStatusCounts = { synced: number; pending: number; failed: number; total: number };

export type ModuleInfo = {
  key: string;
  label: string;
  singularLabel: string | null;
  isSingleton: boolean;
  fields: FieldDef[];
  canManage: boolean;
  permissionLevel: PermissionLevel;
  lastImportedAt: string | null;
  lastImportRecordCount: number | null;
  itemCounts: SyncStatusCounts;
};

// Standardized admin GET/import query filters — same shape for every
// feature and every tenant's site (see
// backend/src/lib/websiteApiClient.ts WebsiteApiImportFilters). Which
// fields a given feature actually honors is up to that tenant's site.
export type WebsiteContentImportFilters = {
  slug?: string;
  id?: string;
  category?: string;
  collection?: string;
  featured?: boolean;
  position?: number;
  code?: string;
};

export type AuthType = "none" | "bearer" | "apiKey" | "basic" | "customHeaders";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type EndpointStatus = {
  method: HttpMethod;
  url: string | null;
  authType: AuthType | null;
  hasCredentials: boolean;
};

export type EndpointInput = {
  method: HttpMethod;
  url?: string;
  authType?: AuthType | null;
  credentials?: Record<string, string>;
};

export type ResponseMapping = { listPath?: string; itemPath?: string };

// A snapshot from "Analyze Endpoint"/"Refresh Schema" — the real external
// GET response walked into typed, dot/bracket-path leaves (see
// backend/src/lib/websiteApiClient.ts's walkSchema for exactly how paths
// like "category.name" or "images[0].url" are produced).
export type DiscoveredFieldType = "string" | "number" | "boolean" | "date" | "array" | "object";
// Name/type only — the backend never returns a real value from the
// tenant's site (see backend's DiscoveredField).
export type DiscoveredField = { path: string; type: DiscoveredFieldType };

export type WebsiteIntegrationStatus = {
  featureId: string;
  featureKey: string;
  featureLabel: string;
  configured: boolean;
  active: boolean;
  baseUrl: string | null;
  authType: AuthType;
  hasCredentials: boolean;
  permissionLevel: PermissionLevel;
  fieldMapping: Record<string, string> | null;
  responseMapping: ResponseMapping | null;
  endpoints: EndpointStatus[];
  // Null = address items by the default baseUrl/externalId path
  // convention. Set = a dashboard field key (e.g. "slug", "code") whose
  // value addresses items via a query parameter on PUT/PATCH/DELETE
  // instead — see backend's buildLookupQueryUrl.
  lookupKey: string | null;
  lastImportedAt: string | null;
  lastImportRecordCount: number | null;
  updatedAt: string | null;
  dashboardFields: FieldDef[];
  discoveredSchema: DiscoveredField[] | null;
  schemaDiscoveredAt: string | null;
  // Dashboard field keys flagged Confidential in Map Your Data — encrypted
  // at rest, stripped from every Data Manager read, never write-enabled
  // unless also in confidentialWriteEnabled.
  confidentialFields: string[];
  confidentialWriteEnabled: string[];
};

// Read-only — see routes/superAdminWebsiteIntegrations.ts. Super Admin no
// longer has a save/test/discoverSchema/delete equivalent; connector
// configuration is tenant-Admin-owned (api/connectorConfig.ts).
export async function listWebsiteIntegrations(tenantId: string): Promise<WebsiteIntegrationStatus[]> {
  const { data } = await apiClient.get<WebsiteIntegrationStatus[]>(`/super-admin/website-integrations/${tenantId}`);
  return data;
}

// Health signal only — no response body ever, for GET or any other
// method. See DiscoverSchemaResult for the (separate, redacted) schema
// preview action.
export type TestEndpointResult = { ok: boolean; status?: number; latencyMs: number; message: string };

export type DiscoverSchemaResult = { fields: DiscoveredField[]; recordCount: number; previousFields: DiscoveredField[] | null };

export type SchemaSnapshot = { id: string; fields: DiscoveredField[]; discoveredAt: string };

// Every past Analyze/Refresh result, newest first (see backend's
// listSchemaSnapshots) — the current/latest one is already included in the
// main status list (discoveredSchema/schemaDiscoveredAt); this is purely
// the "what did it look like before" history view.
export async function listSchemaHistory(tenantId: string, featureKey: string): Promise<SchemaSnapshot[]> {
  const { data } = await apiClient.get<SchemaSnapshot[]>(
    `/super-admin/website-integrations/${tenantId}/${featureKey}/schema-history`
  );
  return data;
}

export type ConnectorAccessLogEntry = {
  id: string;
  action: "CREDENTIAL_SAVED" | "TEST_CONNECTION" | "SCHEMA_DISCOVERY" | "SYNC_IMPORT" | "SYNC_EXPORT" | "CONFIDENTIAL_FIELD_REVEALED";
  actionLabel: string;
  outcome: "success" | "failure";
  actorLabel: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

// Connector audit trail — every credential save/replace, Test Connection,
// schema discovery, sync, and Confidential-field decrypt for this feature,
// newest first. actorLabel is already resolved server-side (a system/cron
// action would render as "System (...)", never blank — see backend's
// lib/connectorAccessLog.ts).
export async function listConnectorAccessLog(tenantId: string, featureKey: string): Promise<ConnectorAccessLogEntry[]> {
  const { data } = await apiClient.get<ConnectorAccessLogEntry[]>(
    `/super-admin/website-integrations/${tenantId}/${featureKey}/access-log`
  );
  return data;
}

// Cross-tenant equivalent of api/websiteContent.ts — Super Admin has full
// create/update/delete/import access to every tenant's website content for
// every feature, regardless of that feature's per-tenant permissionLevel
// (that flag only gates the Business Admin router).
export type WebsiteContentItem = {
  id: string;
  featureId: string;
  externalId: string | null;
  payload: Record<string, unknown>;
  syncStatus: "pending" | "synced" | "failed";
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListItemsResult = { items: WebsiteContentItem[]; total: number; page: number; pageSize: number };

export async function listWebsiteContentModules(tenantId: string): Promise<ModuleInfo[]> {
  const { data } = await apiClient.get<ModuleInfo[]>(`/super-admin/website-content/${tenantId}/modules`);
  return data;
}

export async function listWebsiteContentItems(
  tenantId: string,
  contentType: WebsiteContentType,
  options?: { search?: string; page?: number; pageSize?: number }
): Promise<ListItemsResult> {
  const { data } = await apiClient.get<ListItemsResult>(`/super-admin/website-content/${tenantId}/${contentType}`, {
    params: options,
  });
  return data;
}

export async function createWebsiteContentItem(
  tenantId: string,
  contentType: WebsiteContentType,
  payload: Record<string, unknown>
): Promise<WebsiteContentItem> {
  const { data } = await apiClient.post<WebsiteContentItem>(`/super-admin/website-content/${tenantId}/${contentType}`, payload);
  return data;
}

export async function updateWebsiteContentItem(
  tenantId: string,
  contentType: WebsiteContentType,
  id: string,
  payload: Record<string, unknown>
): Promise<WebsiteContentItem> {
  const { data } = await apiClient.patch<WebsiteContentItem>(`/super-admin/website-content/${tenantId}/${contentType}/${id}`, payload);
  return data;
}

export async function deleteWebsiteContentItem(tenantId: string, contentType: WebsiteContentType, id: string): Promise<void> {
  await apiClient.delete(`/super-admin/website-content/${tenantId}/${contentType}/${id}`);
}

export async function importWebsiteContentItems(
  tenantId: string,
  contentType: WebsiteContentType,
  filters?: WebsiteContentImportFilters
): Promise<{ imported: number; skipped: number; removed: number; items: WebsiteContentItem[] }> {
  const { data } = await apiClient.post(`/super-admin/website-content/${tenantId}/${contentType}/import`, filters ?? {});
  return data;
}

export async function syncWebsiteContentItems(
  tenantId: string,
  contentType: WebsiteContentType
): Promise<{ retried: number; retriedFailed: number; imported: number; skipped: number; removed: number; items: WebsiteContentItem[] }> {
  const { data } = await apiClient.post(`/super-admin/website-content/${tenantId}/${contentType}/sync`);
  return data;
}

export async function uploadWebsiteContentImage(tenantId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<{ url: string }>(`/super-admin/website-content/${tenantId}/uploads`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}
