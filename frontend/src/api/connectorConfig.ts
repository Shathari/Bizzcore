import { apiClient } from "./client";
import type {
  WebsiteIntegrationStatus,
  AuthType,
  PermissionLevel,
  HttpMethod,
  EndpointInput,
  ResponseMapping,
  TestEndpointResult,
  DiscoverSchemaResult,
  SchemaSnapshot,
  ConnectorAccessLogEntry,
} from "./superAdminWebsite";
import type { WebsiteIntegrationsApi } from "../components/WebsiteIntegrationsPanel";

// Tenant-Admin-facing counterpart of api/superAdminWebsite.ts's
// integration-config functions — same shapes, but scoped to the calling
// tenant via auth (no tenantId in the URL) and hitting
// /api/connector-config (routes/connectorConfig.ts) instead of the
// Super-Admin-only, now read-only /api/super-admin/website-integrations.

export async function listConnectorConfigs(): Promise<WebsiteIntegrationStatus[]> {
  const { data } = await apiClient.get<WebsiteIntegrationStatus[]>("/connector-config");
  return data;
}

export async function saveConnectorConfig(
  featureKey: string,
  input: {
    baseUrl: string;
    authType: AuthType;
    credentials?: Record<string, string>;
    active?: boolean;
    permissionLevel?: PermissionLevel;
    fieldMapping?: Record<string, string> | null;
    responseMapping?: ResponseMapping | null;
    endpoints?: EndpointInput[];
    lookupKey?: string | null;
    confidentialFields?: string[];
    confidentialWriteEnabled?: string[];
  }
): Promise<WebsiteIntegrationStatus> {
  const { data } = await apiClient.put<WebsiteIntegrationStatus>(`/connector-config/${featureKey}`, input);
  return data;
}

export async function deleteConnectorConfig(featureKey: string): Promise<void> {
  await apiClient.delete(`/connector-config/${featureKey}`);
}

export async function testConnectorConfigEndpoint(
  featureKey: string,
  input: { method: HttpMethod; url: string; authType: AuthType; credentials?: Record<string, string> }
): Promise<TestEndpointResult> {
  const { data } = await apiClient.post<TestEndpointResult>(`/connector-config/${featureKey}/test`, input);
  return data;
}

export async function discoverConnectorConfigSchema(
  featureKey: string,
  input: { url: string; authType: AuthType; credentials?: Record<string, string> }
): Promise<DiscoverSchemaResult> {
  const { data } = await apiClient.post<DiscoverSchemaResult>(`/connector-config/${featureKey}/discover-schema`, input);
  return data;
}

export async function listConnectorConfigSchemaHistory(featureKey: string): Promise<SchemaSnapshot[]> {
  const { data } = await apiClient.get<SchemaSnapshot[]>(`/connector-config/${featureKey}/schema-history`);
  return data;
}

export async function listConnectorConfigAccessLog(featureKey: string): Promise<ConnectorAccessLogEntry[]> {
  const { data } = await apiClient.get<ConnectorAccessLogEntry[]>(`/connector-config/${featureKey}/access-log`);
  return data;
}

export const connectorConfigApi: WebsiteIntegrationsApi = {
  list: listConnectorConfigs,
  save: saveConnectorConfig,
  remove: deleteConnectorConfig,
  test: testConnectorConfigEndpoint,
  discoverSchema: discoverConnectorConfigSchema,
  schemaHistory: listConnectorConfigSchemaHistory,
  accessLog: listConnectorConfigAccessLog,
};
