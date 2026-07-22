import { prisma } from "./prisma";

// The AccessLog pattern (lib/accessLog.ts), applied to the external data
// connector: one row per credential save/replace, Test Connection call,
// schema discovery run, sync (import and export/write-back), and any
// server-side decrypt of a Confidential field's value for reprocessing.
// Every call site that touches a tenant's connector should go through
// logConnectorAccess so "does this capture everything" reduces to "does
// every call site call this," same as the Customer PII trail.

export type ConnectorAction =
  | "CREDENTIAL_SAVED" // saveIntegration wrote a new/replaced credential (integration- or endpoint-level)
  | "TEST_CONNECTION" // the Test button's connectivity check
  | "SCHEMA_DISCOVERY" // Analyze Endpoint / Refresh Schema
  | "SYNC_IMPORT" // pulling data in from the tenant's site
  | "SYNC_EXPORT" // pushing data out (create/update push, including Sync Now retries)
  | "CONFIDENTIAL_FIELD_REVEALED" // server-side decrypt of a Confidential field to reprocess it (e.g. a retry push)
  | "CREDENTIAL_LOGIN"; // authType "login" — logging in to the tenant's own site to get/refresh an access token (details.trigger: "save" | "manual" | "automatic_401")

export type ConnectorOutcome = "success" | "failure";

export async function logConnectorAccess(params: {
  tenantId: string;
  featureId: string;
  websiteIntegrationId: string | null;
  actorId: string | null;
  action: ConnectorAction;
  outcome: ConnectorOutcome;
  details?: Record<string, unknown>;
}): Promise<void> {
  await prisma.connectorAccessLog.create({
    data: {
      tenantId: params.tenantId,
      featureId: params.featureId,
      websiteIntegrationId: params.websiteIntegrationId,
      actorId: params.actorId,
      action: params.action,
      outcome: params.outcome,
      details: params.details ? JSON.stringify(params.details) : null,
    },
  });
}

export const CONNECTOR_ACTION_LABELS: Record<ConnectorAction, string> = {
  CREDENTIAL_SAVED: "Credential saved",
  TEST_CONNECTION: "Test connection",
  SCHEMA_DISCOVERY: "Schema discovery",
  SYNC_IMPORT: "Sync (import)",
  SYNC_EXPORT: "Sync (export)",
  CONFIDENTIAL_FIELD_REVEALED: "Confidential field decrypted",
  CREDENTIAL_LOGIN: "Login / token refresh",
};

export type ConnectorAccessLogEntry = {
  id: string;
  action: ConnectorAction;
  actionLabel: string;
  outcome: ConnectorOutcome;
  actorLabel: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
};

// actorId is null for every system/cron-triggered connector action (none
// exist yet, but the resolution is built to handle one correctly rather
// than rendering blank/"null" the day one is added — see
// CONFIDENTIAL_FIELD_REVEALED's own comment). Resolves actor names in one
// batch query rather than one lookup per row, same as
// lib/accessLog.ts's listAccessLogForCustomer.
export async function listConnectorAccessLog(
  tenantId: string,
  featureId: string,
  limit = 30
): Promise<ConnectorAccessLogEntry[]> {
  const rows = await prisma.connectorAccessLog.findMany({
    where: { tenantId, featureId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a.name || a.email]));

  return rows.map((r) => {
    const action = r.action as ConnectorAction;
    return {
      id: r.id,
      action,
      actionLabel: CONNECTOR_ACTION_LABELS[action] ?? r.action,
      outcome: r.outcome as ConnectorOutcome,
      actorLabel: r.actorId
        ? (actorById.get(r.actorId) ?? "Unknown user")
        : `System (${(CONNECTOR_ACTION_LABELS[action] ?? r.action).toLowerCase()})`,
      details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
      createdAt: r.createdAt,
    };
  });
}
