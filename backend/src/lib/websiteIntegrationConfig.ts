import { z } from "zod";
import { prisma } from "./prisma";
import {
  encryptCredentials,
  buildAuthHeaders,
  discoverSchema,
  fetchWithTimeout,
  REQUEST_TIMEOUT_MS,
  type DiscoveredField,
} from "./websiteApiClient";
import { listFeatures, getFeatureByKey, type FieldDef } from "./featureCatalog";
import { logConnectorAccess } from "./connectorAccessLog";

// Tenant-Admin-owned: configures, per tenant and per feature (built-in or
// custom — see lib/featureCatalog.ts), the external website API a
// business's own dashboard actions get pushed to, plus optional
// per-HTTP-method endpoint overrides and field-name mapping. Called from
// the tenant-scoped routes/connectorConfig.ts (authorize("ADMIN")); Super
// Admin's routes/superAdminWebsiteIntegrations.ts only reads from this
// module (listIntegrationStatuses/listSchemaSnapshots), never writes.

// "login" is base-integration-only (see lib/connectorLogin.ts) — its
// credentials (loginUrl/email/password) go through the dedicated
// saveLoginCredentials flow, never through this file's generic
// `credentials` field, so it's deliberately excluded from
// ENDPOINT_AUTH_TYPES (a per-method override can't be "login") while still
// being a valid value for the shared integration-level authType.
export const AUTH_TYPES = ["none", "bearer", "apiKey", "basic", "customHeaders", "login"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

const ENDPOINT_AUTH_TYPES = ["none", "bearer", "apiKey", "basic", "customHeaders"] as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const PERMISSION_LEVELS = ["VIEW", "MANAGE"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

// All connector traffic must be TLS — credentials go out in headers
// (buildAuthHeaders) on every one of these calls, so an http:// baseUrl
// would mean sending them in the clear. Applied everywhere a connector URL
// is accepted: the saved baseUrl, per-method endpoint overrides, and the
// ad hoc Test/Analyze URLs (which can differ from what's saved, per the
// "test before save" flow).
const HTTPS_ONLY_MESSAGE = "URL must use https:// — plaintext (http://) connections are not allowed";
function httpsUrl(requiredMessage = "Enter a valid URL") {
  return z
    .string()
    .trim()
    .url(requiredMessage)
    .refine((u) => u.toLowerCase().startsWith("https://"), HTTPS_ONLY_MESSAGE);
}

const credentialsSchemaByType: Record<AuthType, z.ZodTypeAny> = {
  none: z.object({}).optional(),
  bearer: z.object({ token: z.string().trim().min(1, "Token is required") }),
  apiKey: z.object({
    headerName: z.string().trim().min(1, "Header name is required"),
    apiKey: z.string().trim().min(1, "API key is required"),
  }),
  basic: z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().trim().min(1, "Password is required"),
  }),
  // Arbitrary { headerName: headerValue } pairs — covers fully custom auth
  // schemes and "paste a static OAuth token as a header" without a
  // dedicated OAuth token-fetch/refresh flow.
  customHeaders: z
    .record(z.string().trim().min(1))
    .refine((obj) => Object.keys(obj).length > 0, "At least one header is required"),
  // Never actually reached — saveIntegration rejects authType "login"
  // before this map is consulted (see its own comment). Present only so
  // the Record<AuthType, ...> type stays total.
  login: z.never(),
};

const endpointSchema = z.object({
  method: z.enum(HTTP_METHODS),
  // Empty string / omitted clears the override for this method — falls
  // back to the shared baseUrl + REST convention.
  url: httpsUrl().optional().or(z.literal("")),
  // Omitted/null = inherit the integration's shared authType. Only set
  // this when the method genuinely needs different auth than the rest.
  // "login" isn't offered here — see ENDPOINT_AUTH_TYPES.
  authType: z.enum(ENDPOINT_AUTH_TYPES).nullable().optional(),
  credentials: z.record(z.string()).optional(),
});
export type EndpointInput = z.infer<typeof endpointSchema>;

// Explicit override for where records live in this tenant's response body —
// consulted BEFORE the auto-detect heuristic in websiteApiClient.ts's
// extractList/fetchWebsiteApiSingle. listPath feeds list-shaped features
// (import), itemPath feeds singleton features (e.g. Contact Details). Either
// a dot-path (e.g. "data.products") or "" (the response body itself is the
// array/item). Both blank/omitted, or an explicit null, clears the override
// and falls back to the heuristic.
const responseMappingSchema = z.object({
  listPath: z.string().trim().optional(),
  itemPath: z.string().trim().optional(),
});
export type ResponseMappingInput = z.infer<typeof responseMappingSchema>;

export const configSchema = z.object({
  baseUrl: httpsUrl(),
  authType: z.enum(AUTH_TYPES).default("none"),
  // Optional so an update can leave credentials untouched (same
  // "blank keeps current" pattern as before).
  credentials: z.record(z.string()).optional(),
  active: z.boolean().optional(),
  permissionLevel: z.enum(PERMISSION_LEVELS).optional(),
  // { dashboardFieldKey: externalFieldKey } — null/omitted clears it (no
  // mapping, dashboard keys sent as-is).
  fieldMapping: z.record(z.string()).nullable().optional(),
  responseMapping: responseMappingSchema.nullable().optional(),
  // Full desired set of per-method overrides — omitted leaves existing
  // overrides untouched; an explicit [] clears all of them.
  endpoints: z.array(endpointSchema).optional(),
  // Dashboard field key (e.g. "slug", "code") whose value addresses an item
  // on PUT/PATCH/DELETE via a query parameter instead of the default
  // baseUrl/externalId path convention — see websiteApiClient.ts's
  // buildLookupQueryUrl. Blank/omitted/null all clear it (path convention).
  lookupKey: z.string().trim().nullable().optional(),
  // Dashboard field keys flagged "Confidential" in Map Your Data. Omitted
  // leaves the existing set untouched; an explicit [] clears it.
  confidentialFields: z.array(z.string()).optional(),
  // Subset of confidentialFields explicitly, separately confirmed for
  // write-back — validated below to reject anything not also confidential.
  confidentialWriteEnabled: z.array(z.string()).optional(),
});

export type EndpointStatus = {
  method: HttpMethod;
  url: string | null;
  authType: AuthType | null;
  hasCredentials: boolean;
};

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
  responseMapping: ResponseMappingInput | null;
  endpoints: EndpointStatus[];
  // Null = address items by the default baseUrl/externalId path convention
  // (see buildLookupQueryUrl). Set = a dashboard field key (e.g. "slug",
  // "code") whose value addresses items via a query parameter instead.
  lookupKey: string | null;
  lastImportedAt: Date | null;
  lastImportRecordCount: number | null;
  updatedAt: Date | null;
  // The Feature's current dashboard fields (already loaded via
  // listFeatures() below, zero extra queries) — the "Dashboard Field" side
  // of the mapping table's dropdowns.
  dashboardFields: FieldDef[];
  // Snapshot from the last "Analyze Endpoint"/"Refresh Schema" call (see
  // discoverAndStoreSchema) — the "External Field" side of the mapping
  // table's dropdowns. Null until first analyzed. Purely UI/diagnostic
  // metadata, never consulted by the actual create/update/import path.
  discoveredSchema: DiscoveredField[] | null;
  schemaDiscoveredAt: Date | null;
  confidentialFields: string[];
  confidentialWriteEnabled: string[];
};

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toEndpointStatus(row: { method: string; url: string | null; authType: string | null; encryptedCredentials: string | null }): EndpointStatus {
  return {
    method: row.method as HttpMethod,
    url: row.url,
    authType: row.authType as AuthType | null,
    hasCredentials: Boolean(row.encryptedCredentials),
  };
}

export async function listIntegrationStatuses(tenantId: string): Promise<WebsiteIntegrationStatus[]> {
  const [features, integrations] = await Promise.all([
    listFeatures(tenantId),
    prisma.websiteIntegration.findMany({ where: { tenantId }, include: { endpoints: true } }),
  ]);
  const byFeatureId = new Map(integrations.map((i) => [i.featureId, i]));

  return features.map((feature) => {
    const existing = byFeatureId.get(feature.id);
    return {
      featureId: feature.id,
      featureKey: feature.key,
      featureLabel: feature.label,
      configured: Boolean(existing),
      active: existing?.active ?? false,
      baseUrl: existing?.baseUrl ?? null,
      authType: (existing?.authType as AuthType) ?? "none",
      hasCredentials: Boolean(existing?.encryptedCredentials),
      permissionLevel: (existing?.permissionLevel as PermissionLevel) ?? "VIEW",
      fieldMapping: existing?.fieldMapping ? JSON.parse(existing.fieldMapping) : null,
      responseMapping: existing?.responseMapping ? JSON.parse(existing.responseMapping) : null,
      endpoints: existing?.endpoints.map(toEndpointStatus) ?? [],
      lookupKey: existing?.lookupKey ?? null,
      lastImportedAt: existing?.lastImportedAt ?? null,
      lastImportRecordCount: existing?.lastImportRecordCount ?? null,
      updatedAt: existing?.updatedAt ?? null,
      dashboardFields: feature.fields,
      discoveredSchema: existing?.discoveredSchema ? JSON.parse(existing.discoveredSchema) : null,
      schemaDiscoveredAt: existing?.schemaDiscoveredAt ?? null,
      confidentialFields: parseStringArray(existing?.confidentialFields),
      confidentialWriteEnabled: parseStringArray(existing?.confidentialWriteEnabled),
    };
  });
}

async function logAudit(actorId: string, action: string, tenantId: string, details: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { actorId, action, targetTenantId: tenantId, details: JSON.stringify(details) },
  });
}

export type SaveIntegrationResult =
  | { ok: true; status: WebsiteIntegrationStatus }
  | { ok: false; error: string };

export async function saveIntegration(
  tenantId: string,
  featureKey: string,
  input: unknown,
  actorId: string
): Promise<SaveIntegrationResult> {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) {
    return { ok: false, error: "Unknown content type" };
  }

  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    baseUrl,
    authType,
    credentials,
    active,
    permissionLevel,
    fieldMapping,
    responseMapping,
    endpoints,
    lookupKey,
    confidentialFields,
    confidentialWriteEnabled,
  } = parsed.data;

  const existing = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId, featureId: feature.id } },
    include: { endpoints: true },
  });

  // confidentialWriteEnabled is meant to be a second, explicit confirmation
  // ON TOP OF a field already being marked Confidential — never a way to
  // write-enable a field that isn't. Resolve against whichever
  // confidentialFields set actually applies to this save (the newly
  // submitted one if provided, else what's already saved) so this check is
  // correct whether both are being updated together or independently.
  if (confidentialWriteEnabled !== undefined) {
    const effectiveConfidential = new Set(
      confidentialFields !== undefined ? confidentialFields : parseStringArray(existing?.confidentialFields)
    );
    const invalid = confidentialWriteEnabled.filter((k) => !effectiveConfidential.has(k));
    if (invalid.length > 0) {
      return {
        ok: false,
        error: `Cannot enable write-back for non-confidential field(s): ${invalid.join(", ")} — mark them Confidential first`,
      };
    }
  }

  // Tracked so exactly one CREDENTIAL_SAVED connector-access-log row goes
  // out after the transaction commits, only when a real credential value
  // was actually written (not for a save that only touched, say,
  // permissionLevel or fieldMapping).
  let credentialSaved = false;

  // "login" credentials (loginUrl/email/password) go through the dedicated
  // saveLoginCredentials flow (lib/connectorLogin.ts), which performs an
  // actual login rather than just encrypting-and-storing a static value —
  // this generic path can still switch AWAY from "login" to another
  // authType (see the else-if below), but never sets it up.
  if (authType === "login" && credentials !== undefined) {
    return { ok: false, error: 'Use the "Log in with admin credentials" action to set up login-based authentication.' };
  }

  let encryptedCredentials = existing?.encryptedCredentials ?? null;
  if (credentials !== undefined) {
    if (authType === "none") {
      encryptedCredentials = null;
    } else {
      const credParsed = credentialsSchemaByType[authType].safeParse(credentials);
      if (!credParsed.success) {
        return { ok: false, error: credParsed.error.issues[0]?.message ?? "Invalid credentials for this auth type" };
      }
      encryptedCredentials = encryptCredentials(credParsed.data);
      credentialSaved = true;
    }
  } else if (authType === "none") {
    encryptedCredentials = null;
  }

  if (authType !== "none" && authType !== "login" && !encryptedCredentials) {
    return { ok: false, error: "Credentials are required for this auth type" };
  }
  if (authType === "login" && !existing?.loginUrl) {
    return { ok: false, error: 'Use the "Log in with admin credentials" action to set up login-based authentication.' };
  }

  // Validate per-method endpoint overrides before writing anything.
  if (endpoints) {
    const existingByMethod = new Map(existing?.endpoints.map((e) => [e.method, e]) ?? []);
    for (const ep of endpoints) {
      if (!ep.authType || ep.authType === "none") continue;
      const existingRow = existingByMethod.get(ep.method);
      const hasNewCreds = ep.credentials !== undefined;
      if (!hasNewCreds && existingRow?.authType === ep.authType && existingRow.encryptedCredentials) continue;
      const credParsed = credentialsSchemaByType[ep.authType].safeParse(ep.credentials ?? {});
      if (!credParsed.success) {
        return { ok: false, error: `${ep.method}: ${credParsed.error.issues[0]?.message ?? "Invalid credentials for this auth type"}` };
      }
    }
  }

  const fieldMappingJson = fieldMapping === undefined ? undefined : fieldMapping === null ? null : JSON.stringify(fieldMapping);
  const confidentialFieldsJson = confidentialFields === undefined ? undefined : JSON.stringify(confidentialFields);
  const confidentialWriteEnabledJson = confidentialWriteEnabled === undefined ? undefined : JSON.stringify(confidentialWriteEnabled);

  // Blank string (the UI's "no lookup key selected" state) clears it, same
  // as an explicit null — undefined (omitted entirely) leaves it untouched.
  const lookupKeyValue = lookupKey === undefined ? undefined : lookupKey === null || lookupKey === "" ? null : lookupKey;

  // A responseMapping object with both paths blank (e.g. the UI's "no
  // override" state) is treated the same as an explicit null — clears the
  // override rather than persisting a functionally-empty JSON blob.
  let responseMappingJson: string | null | undefined;
  if (responseMapping === undefined) {
    responseMappingJson = undefined;
  } else if (responseMapping === null || (!responseMapping.listPath && !responseMapping.itemPath)) {
    responseMappingJson = null;
  } else {
    responseMappingJson = JSON.stringify({
      ...(responseMapping.listPath ? { listPath: responseMapping.listPath } : {}),
      ...(responseMapping.itemPath ? { itemPath: responseMapping.itemPath } : {}),
    });
  }

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.websiteIntegration.upsert({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
      create: {
        tenantId,
        featureId: feature.id,
        baseUrl,
        authType,
        encryptedCredentials,
        active: active ?? true,
        permissionLevel: permissionLevel ?? "VIEW",
        fieldMapping: fieldMappingJson ?? null,
        responseMapping: responseMappingJson ?? null,
        lookupKey: lookupKeyValue ?? null,
        confidentialFields: confidentialFieldsJson ?? null,
        confidentialWriteEnabled: confidentialWriteEnabledJson ?? null,
      },
      update: {
        baseUrl,
        authType,
        encryptedCredentials,
        active: active ?? existing?.active ?? true,
        permissionLevel: permissionLevel ?? existing?.permissionLevel ?? "VIEW",
        fieldMapping: fieldMappingJson !== undefined ? fieldMappingJson : existing?.fieldMapping,
        responseMapping: responseMappingJson !== undefined ? responseMappingJson : existing?.responseMapping,
        lookupKey: lookupKeyValue !== undefined ? lookupKeyValue : existing?.lookupKey,
        confidentialFields: confidentialFieldsJson !== undefined ? confidentialFieldsJson : existing?.confidentialFields,
        confidentialWriteEnabled:
          confidentialWriteEnabledJson !== undefined ? confidentialWriteEnabledJson : existing?.confidentialWriteEnabled,
      },
    });

    if (endpoints) {
      const existingByMethod = new Map(existing?.endpoints.map((e) => [e.method, e]) ?? []);
      const keepMethods = new Set(endpoints.map((e) => e.method));
      // Full-replace semantics: drop overrides for methods no longer present.
      await tx.websiteIntegrationEndpoint.deleteMany({
        where: { integrationId: row.id, method: { notIn: [...keepMethods] } },
      });
      for (const ep of endpoints) {
        const existingRow = existingByMethod.get(ep.method);
        let epEncryptedCredentials = existingRow?.encryptedCredentials ?? null;
        if (!ep.authType || ep.authType === "none") {
          epEncryptedCredentials = null;
        } else if (ep.credentials !== undefined) {
          epEncryptedCredentials = encryptCredentials(credentialsSchemaByType[ep.authType].parse(ep.credentials));
          credentialSaved = true;
        } else if (existingRow?.authType !== ep.authType) {
          // Auth type changed but no fresh credentials given, and nothing to carry over.
          epEncryptedCredentials = null;
        }
        await tx.websiteIntegrationEndpoint.upsert({
          where: { integrationId_method: { integrationId: row.id, method: ep.method } },
          create: {
            integrationId: row.id,
            method: ep.method,
            url: ep.url || null,
            authType: ep.authType ?? null,
            encryptedCredentials: epEncryptedCredentials,
          },
          update: {
            url: ep.url || null,
            authType: ep.authType ?? null,
            encryptedCredentials: epEncryptedCredentials,
          },
        });
      }
    }

    return tx.websiteIntegration.findUniqueOrThrow({ where: { id: row.id }, include: { endpoints: true } });
  });

  await logAudit(actorId, "INTEGRATION_CONFIG_SAVED", tenantId, {
    featureKey: feature.key,
    baseUrl: saved.baseUrl,
    authType: saved.authType,
    active: saved.active,
    permissionLevel: saved.permissionLevel,
    responseMapping: saved.responseMapping,
    endpointOverrides: saved.endpoints.map((e) => ({ method: e.method, url: e.url, authType: e.authType })),
    lookupKey: saved.lookupKey,
    // Field key NAMES only (never values — those aren't in scope here at
    // all, this whole config path never touches WebsiteContentItem.payload).
    confidentialFields: parseStringArray(saved.confidentialFields),
    confidentialWriteEnabled: parseStringArray(saved.confidentialWriteEnabled),
  });

  if (credentialSaved) {
    await logConnectorAccess({
      tenantId,
      featureId: feature.id,
      websiteIntegrationId: saved.id,
      actorId,
      action: "CREDENTIAL_SAVED",
      outcome: "success",
      details: { authType: saved.authType },
    });
  }

  return {
    ok: true,
    status: {
      featureId: feature.id,
      featureKey: feature.key,
      featureLabel: feature.label,
      configured: true,
      active: saved.active,
      baseUrl: saved.baseUrl,
      authType: saved.authType as AuthType,
      hasCredentials: Boolean(saved.encryptedCredentials),
      permissionLevel: saved.permissionLevel as PermissionLevel,
      fieldMapping: saved.fieldMapping ? JSON.parse(saved.fieldMapping) : null,
      responseMapping: saved.responseMapping ? JSON.parse(saved.responseMapping) : null,
      endpoints: saved.endpoints.map(toEndpointStatus),
      lookupKey: saved.lookupKey,
      lastImportedAt: saved.lastImportedAt,
      lastImportRecordCount: saved.lastImportRecordCount,
      updatedAt: saved.updatedAt,
      dashboardFields: feature.fields,
      discoveredSchema: saved.discoveredSchema ? JSON.parse(saved.discoveredSchema) : null,
      schemaDiscoveredAt: saved.schemaDiscoveredAt,
      confidentialFields: parseStringArray(saved.confidentialFields),
      confidentialWriteEnabled: parseStringArray(saved.confidentialWriteEnabled),
    },
  };
}

export async function deleteIntegration(tenantId: string, featureKey: string, actorId: string): Promise<void> {
  const feature = await getFeatureByKey(tenantId, featureKey);
  if (!feature) return;
  const { count } = await prisma.websiteIntegration.deleteMany({ where: { tenantId, featureId: feature.id } });
  if (count > 0) {
    await logAudit(actorId, "INTEGRATION_CONFIG_DELETED", tenantId, { featureKey: feature.key });
  }
}

export const testEndpointSchema = z.object({
  method: z.enum(HTTP_METHODS),
  url: httpsUrl(),
  authType: z.enum(AUTH_TYPES),
  // Omitted = test with whatever's already saved for this exact
  // method+authType (the same "blank keeps current" convention as save) —
  // lets Super Admin test an already-configured row without retyping
  // credentials. Provided = test with these instead, without persisting
  // them (a true dry run of not-yet-saved edits).
  credentials: z.record(z.string()).optional(),
});
export type TestEndpointInput = z.infer<typeof testEndpointSchema>;

// Health signal only — no response body/field values ever, for GET or any
// other method. An admin confirming "is this the right endpoint" uses the
// separate Analyze Endpoint/discover-schema action for that (redacted
// field names + types + record count, see DiscoverSchemaApiResult below),
// not this one.
export type TestEndpointResult = { ok: boolean; status?: number; latencyMs: number; message: string };

// Shared "credentials provided vs fall back to already-saved" resolution —
// used by both the Test button and Analyze Endpoint/Refresh Schema, since
// both need identical semantics: test/analyze with whatever's currently
// typed in the form, or with whatever's already saved for this exact
// method+authType if the form left credentials blank (the same
// "blank keeps current" convention saveIntegration itself uses).
async function resolveCredentialsForTest(
  tenantId: string,
  featureId: string,
  method: HttpMethod,
  authType: AuthType,
  credentials: Record<string, string> | undefined
): Promise<{ ok: true; encryptedCredentials: string | null } | { ok: false; error: string }> {
  if (authType === "none") return { ok: true, encryptedCredentials: null };

  if (credentials !== undefined) {
    const credParsed = credentialsSchemaByType[authType].safeParse(credentials);
    if (!credParsed.success) {
      return { ok: false, error: credParsed.error.issues[0]?.message ?? "Invalid credentials for this auth type" };
    }
    return { ok: true, encryptedCredentials: encryptCredentials(credParsed.data) };
  }

  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId, featureId } },
    include: { endpoints: true },
  });
  const override = integration?.endpoints.find((e) => e.method === method);
  if (override?.authType === authType && override.encryptedCredentials) {
    return { ok: true, encryptedCredentials: override.encryptedCredentials };
  }
  if (integration?.authType === authType && integration.encryptedCredentials) {
    return { ok: true, encryptedCredentials: integration.encryptedCredentials };
  }
  return { ok: false, error: "No saved credentials for this auth type yet — enter them to test." };
}

// Connectivity-only check backing the Test button on each per-method row
// (WebsiteIntegrationsPanel.tsx) — resolves the exact URL + auth a real
// call would use, then probes it. Always a GET regardless of the row being
// tested — a HEAD/OPTIONS probe was considered but many real-world APIs
// don't implement them reliably on non-GET routes, giving false negatives,
// whereas a GET to the same URL still answers "is this host reachable, is
// TLS OK, is this auth accepted" without ever creating/modifying/deleting
// data on the tenant's live site. Response body is never read at all here
// — this returns a health signal (ok/status/latency/message) only. An
// admin who wants to confirm the endpoint shape uses Analyze Endpoint
// (discoverAndStoreSchema below), which returns redacted field names/types
// + a record count, never real values either.
export async function testEndpointConnection(
  tenantId: string,
  featureId: string,
  input: TestEndpointInput,
  actorId: string | null
): Promise<TestEndpointResult> {
  // Present when this feature already has a saved integration ("test
  // before save" flows against a not-yet-saved config, so this is
  // legitimately null sometimes) — only used to attach the log row to it.
  const integration = await prisma.websiteIntegration.findUnique({
    where: { tenantId_featureId: { tenantId, featureId } },
    select: { id: true },
  });

  async function logResult(result: TestEndpointResult): Promise<TestEndpointResult> {
    await logConnectorAccess({
      tenantId,
      featureId,
      websiteIntegrationId: integration?.id ?? null,
      actorId,
      action: "TEST_CONNECTION",
      outcome: result.ok ? "success" : "failure",
      details: { method: input.method, status: result.status ?? null, latencyMs: result.latencyMs },
    });
    return result;
  }

  const resolved = await resolveCredentialsForTest(tenantId, featureId, input.method, input.authType, input.credentials);
  if (!resolved.ok) return logResult({ ok: false, latencyMs: 0, message: resolved.error });

  const headers = buildAuthHeaders(input.authType, resolved.encryptedCredentials);

  const startedAt = Date.now();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(input.url, { method: "GET", headers });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const timedOut = err instanceof Error && err.name === "AbortError";
    return logResult({
      ok: false,
      latencyMs,
      message: timedOut ? `Timed out after ${REQUEST_TIMEOUT_MS}ms` : `Unreachable: ${err instanceof Error ? err.message : "network error"}`,
    });
  }
  const latencyMs = Date.now() - startedAt;

  if (input.method === "GET") {
    return logResult({
      ok: resp.ok,
      status: resp.status,
      latencyMs,
      message: resp.ok ? `Reachable — HTTP ${resp.status}` : `HTTP ${resp.status}`,
    });
  }

  if (resp.status === 401 || resp.status === 403) {
    return logResult({ ok: false, status: resp.status, latencyMs, message: `Reachable, but auth was rejected (HTTP ${resp.status})` });
  }
  if (resp.status >= 500) {
    return logResult({ ok: false, status: resp.status, latencyMs, message: `Server error (HTTP ${resp.status})` });
  }
  return logResult({
    ok: true,
    status: resp.status,
    latencyMs,
    message: `Reachable — HTTP ${resp.status} (connectivity check only; ${input.method} was not actually sent)`,
  });
}

export const discoverSchemaInputSchema = z.object({
  url: httpsUrl(),
  authType: z.enum(AUTH_TYPES),
  // Same "blank keeps current" convention as testEndpointConnection — omit
  // to analyze using whatever's already saved for GET.
  credentials: z.record(z.string()).optional(),
});
export type DiscoverSchemaInput = z.infer<typeof discoverSchemaInputSchema>;

export type DiscoverSchemaApiResult =
  | { ok: true; fields: DiscoveredField[]; recordCount: number; previousFields: DiscoveredField[] | null }
  | { ok: false; error: string };

// How many past schema snapshots to keep per integration (see
// WebsiteIntegrationSchemaSnapshot) — this is a low-frequency,
// admin-triggered action, but unbounded growth either way isn't a
// guarantee worth making.
const SCHEMA_SNAPSHOT_RETENTION = 20;

// "Analyze Endpoint" / "Refresh Schema" (WebsiteIntegrationsPanel.tsx) —
// always a GET (schema discovery only makes sense against the list/import
// endpoint), reusing the exact same credential-resolution semantics as the
// Test button via resolveCredentialsForTest. Persists the result so a
// later "Refresh" click can diff against it — the diff itself is computed
// client-side from the {fields, previousFields} this returns, no separate
// diff endpoint needed. Also appends to the integration's schema history
// (see listSchemaSnapshots) — WebsiteIntegration.discoveredSchema stays the
// fast-access "current" snapshot every existing read path already uses;
// the history table is purely additive, an append-only log of every
// snapshot that ever superseded a previous one.
export async function discoverAndStoreSchema(
  tenantId: string,
  featureId: string,
  featureKey: string,
  input: DiscoverSchemaInput,
  actorId: string | null
): Promise<DiscoverSchemaApiResult> {
  const integration = await prisma.websiteIntegration.findUnique({ where: { tenantId_featureId: { tenantId, featureId } } });

  async function logResult(result: DiscoverSchemaApiResult): Promise<DiscoverSchemaApiResult> {
    await logConnectorAccess({
      tenantId,
      featureId,
      websiteIntegrationId: integration?.id ?? null,
      actorId,
      action: "SCHEMA_DISCOVERY",
      outcome: result.ok ? "success" : "failure",
      details: result.ok ? { fieldCount: result.fields.length, recordCount: result.recordCount } : { error: result.error.slice(0, 200) },
    });
    return result;
  }

  const resolved = await resolveCredentialsForTest(tenantId, featureId, "GET", input.authType, input.credentials);
  if (!resolved.ok) return logResult({ ok: false, error: resolved.error });

  const responseMapping = integration?.responseMapping ? (JSON.parse(integration.responseMapping) as { listPath?: string }) : null;

  const headers = buildAuthHeaders(input.authType, resolved.encryptedCredentials);
  const result = await discoverSchema(input.url, headers, responseMapping?.listPath, { tenantId, contentType: featureKey });
  if (!result.success || !result.fields) {
    return logResult({ ok: false, error: result.error ?? "Could not analyze this endpoint." });
  }

  const previousFields: DiscoveredField[] | null = integration?.discoveredSchema ? JSON.parse(integration.discoveredSchema) : null;

  // Only an already-saved integration has a row to attach the snapshot to
  // — analyzing before ever saving (same "test before save" pattern as the
  // Test button) still returns fields, just doesn't persist them.
  if (integration) {
    const fieldsJson = JSON.stringify(result.fields);
    const discoveredAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.websiteIntegration.update({
        where: { id: integration.id },
        data: { discoveredSchema: fieldsJson, schemaDiscoveredAt: discoveredAt },
      });
      await tx.websiteIntegrationSchemaSnapshot.create({
        data: { integrationId: integration.id, fields: fieldsJson, discoveredAt },
      });
      const stale = await tx.websiteIntegrationSchemaSnapshot.findMany({
        where: { integrationId: integration.id },
        orderBy: { discoveredAt: "desc" },
        skip: SCHEMA_SNAPSHOT_RETENTION,
        select: { id: true },
      });
      if (stale.length > 0) {
        await tx.websiteIntegrationSchemaSnapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      }
    });
  }

  return logResult({ ok: true, fields: result.fields, recordCount: result.recordCount ?? 0, previousFields });
}

export type SchemaSnapshotSummary = { id: string; fields: DiscoveredField[]; discoveredAt: Date };

// Full history for the "Schema history" list (WebsiteIntegrationsPanel.tsx)
// — newest first, same retention cap as what's actually persisted.
export async function listSchemaSnapshots(tenantId: string, featureId: string): Promise<SchemaSnapshotSummary[]> {
  const integration = await prisma.websiteIntegration.findUnique({ where: { tenantId_featureId: { tenantId, featureId } } });
  if (!integration) return [];
  const snapshots = await prisma.websiteIntegrationSchemaSnapshot.findMany({
    where: { integrationId: integration.id },
    orderBy: { discoveredAt: "desc" },
    take: SCHEMA_SNAPSHOT_RETENTION,
  });
  return snapshots.map((s) => ({ id: s.id, fields: JSON.parse(s.fields), discoveredAt: s.discoveredAt }));
}
