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
