import { apiClient } from "./client";

// Tenant-facing "Log in with admin credentials" flow (see
// backend/src/lib/connectorLogin.ts) — a sub-flow of connector
// configuration (api/connectorConfig.ts) for sites that only offer a
// login rather than a long-lived pasteable token.

export type CredentialStatus = "OK" | "CredentialsExpired";

export type ConnectorLoginStatus = {
  authType: string;
  loginConfigured: boolean;
  loginUrl: string | null;
  credentialStatus: CredentialStatus;
  tokenExpiresAt: string | null;
};

export async function getConnectorLoginStatus(contentType: string): Promise<ConnectorLoginStatus> {
  const { data } = await apiClient.get<ConnectorLoginStatus>(`/connector-login/${contentType}/status`);
  return data;
}

// One login per connected website (DataSource), shared by every feature on
// it — not one per feature. A write action (save/refresh) is still issued
// against any one of a DataSource's `features` (see saveConnectorLogin/
// refreshConnectorToken above) since they all resolve to the same
// DataSource server-side; which feature key is used is just a routing
// detail.
export type ConnectorDataSource = {
  id: string;
  origin: string;
  loginConfigured: boolean;
  credentialStatus: CredentialStatus;
  tokenExpiresAt: string | null;
  features: { key: string; label: string; usingLogin: boolean }[];
};

export async function listConnectorDataSources(): Promise<ConnectorDataSource[]> {
  const { data } = await apiClient.get<ConnectorDataSource[]>("/connector-login/data-sources");
  return data;
}

export async function saveConnectorLogin(
  contentType: string,
  input: { loginUrl: string; email: string; password: string }
): Promise<{ credentialStatus: CredentialStatus; tokenExpiresAt: string | null }> {
  const { data } = await apiClient.put(`/connector-login/${contentType}`, input);
  return data;
}

export async function refreshConnectorToken(contentType: string): Promise<{ credentialStatus: CredentialStatus; tokenExpiresAt: string | null }> {
  const { data } = await apiClient.post(`/connector-login/${contentType}/refresh`);
  return data;
}
